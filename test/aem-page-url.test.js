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
import { parseAemPageUrl, toDaPath } from '../src/main/aem-page-url.js';

test('parseAemPageUrl extracts org, repo, and branch', () => {
  const parsed = parseAemPageUrl('https://main--id--davidnuescheler.aem.page/');
  assert.equal(parsed.org, 'davidnuescheler');
  assert.equal(parsed.repo, 'id');
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.previewUrl, 'https://main--id--davidnuescheler.aem.page');
});

test('parseAemPageUrl rejects non-aem URLs', () => {
  assert.throws(() => parseAemPageUrl('https://example.com/'), /Not a valid/);
});

test('toDaPath strips org/repo prefix', () => {
  assert.equal(
    toDaPath('/davidnuescheler/id/blog/post.html', 'davidnuescheler', 'id'),
    '/blog/post.html',
  );
});
