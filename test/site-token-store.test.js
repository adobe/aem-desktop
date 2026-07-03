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
import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isSiteTokenExpired,
  loadSiteTokens,
  saveSiteTokens,
  siteTokenKey,
} from '../src/main/site-token-store.js';

test('isSiteTokenExpired flags missing token', () => {
  assert.equal(isSiteTokenExpired(null), true);
  assert.equal(isSiteTokenExpired({}), true);
  assert.equal(isSiteTokenExpired({ token: '' }), true);
});

test('isSiteTokenExpired honors the 60s buffer', () => {
  assert.equal(isSiteTokenExpired({ token: 't', expiresAt: Date.now() + 5 * 60_000 }), false);
  assert.equal(isSiteTokenExpired({ token: 't', expiresAt: Date.now() + 30_000 }), true);
  assert.equal(isSiteTokenExpired({ token: 't', expiresAt: Date.now() - 1 }), true);
});

test('isSiteTokenExpired treats a token without expiry as usable', () => {
  assert.equal(isSiteTokenExpired({ token: 't', expiresAt: null }), false);
  assert.equal(isSiteTokenExpired({ token: 't' }), false);
});

test('siteTokenKey reduces a preview URL to its origin', () => {
  assert.equal(
    siteTokenKey('https://main--it-waters-website--waterscorporation.aem.page/drafts/x'),
    'https://main--it-waters-website--waterscorporation.aem.page',
  );
});

test('site token store round-trips and tolerates a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-site-token-'));
  const path = join(dir, '.site-tokens.json');

  assert.deepEqual(await loadSiteTokens(path), {});

  const key = 'https://main--site--org.aem.page';
  await saveSiteTokens(path, { [key]: { token: 'hlx_abc', expiresAt: 123 } });
  const loaded = await loadSiteTokens(path);
  assert.deepEqual(loaded[key], { token: 'hlx_abc', expiresAt: 123 });
});

test('site token store writes the credential file owner-only', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-site-token-'));
  const path = join(dir, '.site-tokens.json');
  await saveSiteTokens(path, { k: { token: 't', expiresAt: null } });
  const { mode } = await stat(path);
  assert.equal(mode.toString(8).slice(-3), '600');
});
