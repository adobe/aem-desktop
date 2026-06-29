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
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { transformContentMetadataHtml } from '../src/main/content-metadata-html.js';
import { prepareLocalHtml } from '../src/main/preview-local.js';
import {
  createMetadataJsonCache,
  fetchRemoteMetadataJson,
  globToRegExp,
  matchMetadataPattern,
  parseMetadataJsonRows,
  resolveMetadataSheetRow,
  resolveMetadataSheetRowForPath,
} from '../src/main/metadata-json.js';

const SAMPLE_SHEET = {
  ':version': 3,
  default: {
    data: [
      { URL: '/page-*', Category: 'rendering-test' },
      { URL: '/exact-match', Keywords: 'Exactomento', 'Short Title': 'E' },
      { URL: '/**', key: 'title', value: 'ACME CORP' },
      { URL: '/**', key: 'description', value: 'Global description' },
    ],
  },
};

test('parseMetadataJsonRows reads default sheet data', () => {
  const rows = parseMetadataJsonRows(SAMPLE_SHEET);
  assert.equal(rows.length, 4);
});

test('globToRegExp matches helix-style patterns', () => {
  const re = globToRegExp('/page-*');
  assert.ok(re?.test('/page-metadata-json'));
  assert.ok(!re?.test('/other'));
});

test('matchMetadataPattern supports exact and glob URLs', () => {
  assert.equal(matchMetadataPattern('/exact-match', '/exact-match'), true);
  assert.equal(matchMetadataPattern('/page-*', '/page-blocks'), true);
});

test('resolveMetadataSheetRow merges matching rows including key/value rows', () => {
  const rows = parseMetadataJsonRows(SAMPLE_SHEET);
  const row = resolveMetadataSheetRow(rows, '/exact-match');
  assert.equal(row?.keywords, 'Exactomento');
  assert.equal(row?.title, 'ACME CORP');
  assert.equal(row?.description, 'Global description');
});

test('fetchRemoteMetadataJson caches per origin', async () => {
  const cache = new Map();
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return {
      ok: true,
      text: async () => JSON.stringify(SAMPLE_SHEET),
    };
  };

  await fetchRemoteMetadataJson('https://main--id--org.aem.page', cache, fetchFn);
  await fetchRemoteMetadataJson('https://main--id--org.aem.page', cache, fetchFn);

  assert.equal(calls, 1);
  assert.equal(cache.get('https://main--id--org.aem.page')?.length, 4);
});

test('resolveMetadataSheetRowForPath prefers local metadata.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-metadata-'));
  await writeFile(join(root, 'metadata.json'), JSON.stringify({
    default: {
      data: [{ URL: '/local-page', Keywords: 'from-local' }],
    },
  }));

  const cache = createMetadataJsonCache();
  const row = await resolveMetadataSheetRowForPath({
    previewUrlOrigin: 'https://main--id--org.aem.page',
    syncRootDir: root,
    previewPath: '/local-page',
    cache: cache.cache,
    fetchFn: async () => {
      throw new Error('should not fetch when local metadata.json exists');
    },
  });

  assert.equal(row?.keywords, 'from-local');
});

test('createMetadataJsonCache clears per origin', () => {
  const store = createMetadataJsonCache();
  store.cache.set('https://main--id--org.aem.page', [{ URL: '/' }]);
  store.clear('https://main--id--org.aem.page/');
  assert.equal(store.cache.size, 0);
});

test('transformContentMetadataHtml applies sheet row meta tags', () => {
  const { metaTagsHtml } = transformContentMetadataHtml('<h1>Hello</h1>', {
    absolutePageUrl: 'http://127.0.0.1:1/exact-match',
    sheetRow: {
      keywords: 'Exactomento',
      title: 'Sheet title',
      description: 'Sheet description',
    },
  });

  assert.match(metaTagsHtml, /<meta name="keywords" content="Exactomento">/);
  assert.match(metaTagsHtml, /<meta property="og:title" content="Sheet title">/);
  assert.match(metaTagsHtml, /<meta name="description" content="Sheet description">/);
});

test('prepareLocalHtml includes metadata.json sheet tags in head', async () => {
  const out = await prepareLocalHtml('<h1>Hello</h1>', 'http://127.0.0.1:1/page', {
    headFragment: '',
    localHtml: '',
    remoteDom: null,
    isModified: false,
  }, {
    sheetRow: { category: 'Marketing', title: 'Preview title' },
  });

  assert.match(out, /<meta name="category" content="Marketing">/);
  assert.match(out, /<meta property="og:title" content="Preview title">/);
});
