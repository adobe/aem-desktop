/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('electron-builder ships signed, notarized macOS artifacts', () => {
  const cfg = read('electron-builder.yml');
  assert.match(cfg, /hardenedRuntime:\s*true/);
  assert.match(cfg, /notarize:\s*true/);
  assert.match(cfg, /entitlements:\s*build\/entitlements\.mac\.plist/);
});

test('electron-builder emits both DMG and ZIP (ZIP required for auto-update)', () => {
  const cfg = read('electron-builder.yml');
  assert.match(cfg, /target:\s*dmg/);
  assert.match(cfg, /target:\s*zip/);
});

test('mac artifactName is space-free so GitHub keeps the update-feed names', () => {
  const cfg = read('electron-builder.yml');
  const line = cfg.split('\n').map((l) => l.trim()).find((l) => l.startsWith('artifactName:'));
  assert.ok(line, 'electron-builder.yml must set a mac artifactName');
  const value = line.slice('artifactName:'.length).trim();
  assert.ok(!value.includes(' '), `artifactName must not contain spaces: ${value}`);
  assert.match(value, /\$\{version\}/);
  assert.match(value, /\$\{arch\}/);
});

test('electron-builder publishes to the GitHub release feed', () => {
  const cfg = read('electron-builder.yml');
  assert.match(cfg, /provider:\s*github/);
});

test('semantic-release attaches the update feed and DMG to the GitHub release', () => {
  const cfg = read('.releaserc.cjs');
  assert.match(cfg, /latest-mac\.yml/);
  assert.match(cfg, /\*\.dmg/);
  assert.match(cfg, /electron-builder/);
});

test('package.json exposes the Electron main entry and updater dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'src/main/index.js');
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater must be a runtime dependency');
});

test('electron-builder is pinned to a version with the macOS keychain signing fix', () => {
  const pkg = JSON.parse(read('package.json'));
  const version = pkg.devDependencies['electron-builder'];
  assert.ok(version, 'electron-builder must be a devDependency');
  // 26.16.1 backported the fix for `security set-key-partition-list` being
  // invoked with the .p12 import password instead of the generated keychain
  // password, which breaks CSC_LINK-based signing on the macOS runners
  // (electron-userland/electron-builder#10066). npm's `latest` dist-tag still
  // points at the older 26.15.3, so "upgrade to latest" is a downgrade here and
  // the floor has to be asserted explicitly.
  const [major, minor, patch] = version.split('.').map(Number);
  const ok = major > 26 || (major === 26 && (minor > 16 || (minor === 16 && patch >= 1)));
  assert.ok(ok, `electron-builder must be >= 26.16.1, got ${version}`);
});
