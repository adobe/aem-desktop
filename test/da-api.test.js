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
  buildAemApiListUrl,
  buildAemApiSourceUrl,
  buildDaLiveListUrl,
  buildDaLiveSourceUrl,
  normalizeAemApiListEntry,
  normalizeDaPath,
  toApiRelativePath,
} from '../src/main/da-api.js';

test('normalizeDaPath and toApiRelativePath', () => {
  assert.equal(normalizeDaPath('/blog/'), '/blog');
  assert.equal(normalizeDaPath('blog'), '/blog');
  assert.equal(toApiRelativePath('/blog/post.html'), 'blog/post.html');
  assert.equal(toApiRelativePath('/'), '');
});

test('da.live URL builders', () => {
  assert.equal(
    buildDaLiveListUrl('owner', 'site', '/'),
    'https://admin.da.live/list/owner/site/',
  );
  assert.equal(
    buildDaLiveSourceUrl('owner', 'site', '/blog/post.html'),
    'https://admin.da.live/source/owner/site/blog/post.html',
  );
});

test('api.aem.live URL builders', () => {
  assert.equal(
    buildAemApiListUrl('owner', 'site', '/'),
    'https://api.aem.live/owner/sites/site/source/',
  );
  assert.equal(
    buildAemApiListUrl('owner', 'site', '/blog'),
    'https://api.aem.live/owner/sites/site/source/blog/',
  );
  assert.equal(
    buildAemApiSourceUrl('owner', 'site', '/blog/post.html'),
    'https://api.aem.live/owner/sites/site/source/blog/post.html',
  );
});

test('normalizeAemApiListEntry maps folder and file entries', () => {
  const folder = normalizeAemApiListEntry(
    { name: 'blog/', 'content-type': 'application/folder' },
    'owner',
    'site',
    '/',
  );
  assert.equal(folder.path, '/owner/site/blog');
  assert.equal(folder.ext, undefined);

  const file = normalizeAemApiListEntry(
    {
      name: 'post.html',
      'content-type': 'text/html',
      'last-modified': '2021-05-29T21:00:00.000Z',
    },
    'owner',
    'site',
    '/blog',
  );
  assert.equal(file.path, '/owner/site/blog/post.html');
  assert.equal(file.name, 'post');
  assert.equal(file.ext, 'html');
  assert.equal(file.lastModified, '2021-05-29T21:00:00.000Z');

  const sheet = normalizeAemApiListEntry(
    {
      name: 'metadata.json',
      'content-type': 'application/json',
    },
    'owner',
    'site',
    '/',
  );
  assert.equal(sheet.name, 'metadata');
  assert.equal(sheet.ext, 'json');
});
