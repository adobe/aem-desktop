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
import {
  parseArgs, resolveSite, siteLabel, parseExcludeArg, pathsToSyncItems,
} from '../src/cli/cli-lib.js';

test('parseArgs splits command, positionals, and flags', () => {
  const { command, positionals, flags } = parseArgs(
    ['download', 'aemsites/wheelercat', '/en/', '--include-binaries', '--folder', '/tmp/x'],
    { valueFlags: ['folder', 'exclude'] },
  );
  assert.equal(command, 'download');
  assert.deepEqual(positionals, ['aemsites/wheelercat', '/en/']);
  assert.equal(flags['include-binaries'], true);
  assert.equal(flags.folder, '/tmp/x');
});

test('parseArgs handles --key=value, bundled short flags, and -- terminator', () => {
  const { flags, positionals } = parseArgs(
    ['upload', '--exclude=*/drafts/*', '-yv', '--', '--not-a-flag'],
    { valueFlags: ['exclude'] },
  );
  assert.equal(flags.exclude, '*/drafts/*');
  assert.equal(flags.y, true);
  assert.equal(flags.v, true);
  assert.deepEqual(positionals, ['--not-a-flag']);
});

const SITES = [
  { id: 'aaaa1111', org: 'aemsites', repo: 'wheelercat' },
  { id: 'bbbb2222', org: 'aemsites', repo: 'vitamix' },
];

test('resolveSite matches by index, id prefix, org/repo, and bare repo', () => {
  assert.equal(resolveSite(SITES, '1').repo, 'wheelercat');
  assert.equal(resolveSite(SITES, '2').repo, 'vitamix');
  assert.equal(resolveSite(SITES, 'bbbb').repo, 'vitamix');
  assert.equal(resolveSite(SITES, 'aemsites/vitamix').repo, 'vitamix');
  assert.equal(resolveSite(SITES, 'wheelercat').repo, 'wheelercat');
});

test('resolveSite returns the lone site when no selector is given', () => {
  assert.equal(resolveSite([SITES[0]], undefined).repo, 'wheelercat');
});

test('resolveSite throws helpfully on ambiguity, miss, empty, and out-of-range', () => {
  assert.throws(() => resolveSite(SITES, undefined), /specify one/);
  assert.throws(() => resolveSite(SITES, 'nope'), /No site matches/);
  assert.throws(() => resolveSite([], '1'), /No sites configured/);
  assert.throws(() => resolveSite(SITES, '9'), /out of range/);
});

test('siteLabel is org/repo', () => {
  assert.equal(siteLabel(SITES[0]), 'aemsites/wheelercat');
});

test('parseExcludeArg trims and drops blanks; ignores non-strings', () => {
  assert.deepEqual(parseExcludeArg(' */drafts/* , ,*/recipes/* '), ['*/drafts/*', '*/recipes/*']);
  assert.deepEqual(parseExcludeArg(true), []);
  assert.deepEqual(parseExcludeArg(undefined), []);
});

test('pathsToSyncItems defaults to the whole site', () => {
  assert.deepEqual(pathsToSyncItems([]), [{
    daPath: '/', isFolder: true, ext: null, lastModified: null,
  }]);
});

test('pathsToSyncItems classifies folders vs files and normalizes leading slash', () => {
  const items = pathsToSyncItems(['en', '/en/index.html', 'blog/']);
  assert.deepEqual(items, [
    {
      daPath: '/en', isFolder: true, ext: null, lastModified: null,
    },
    {
      daPath: '/en/index.html', isFolder: false, ext: 'html', lastModified: null,
    },
    {
      daPath: '/blog', isFolder: true, ext: null, lastModified: null,
    },
  ]);
});
