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
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPreviewServer } from '../src/main/preview-server.js';
import { createHeadHtmlCache } from '../src/main/head-html.js';

test('preview server serves transformed local html at root path', async () => {
  const syncFolder = await mkdtemp(join(tmpdir(), 'aem-sync-'));
  const org = 'davidnuescheler';
  const repo = 'id';
  const contentRoot = join(syncFolder, org, repo);
  await mkdir(contentRoot, { recursive: true });
  await writeFile(join(contentRoot, 'local.html'), `<div class="metadata">
<div>Title</div><div>Local page</div>
</div>
<h1>Local page</h1>`);
  await writeFile(join(contentRoot, 'metadata.json'), JSON.stringify({
    default: {
      data: [{ URL: '/local', Keywords: 'sheet-keyword' }],
    },
  }));

  const headCalls = [];
  const metadataCalls = [];
  const server = await startPreviewServer({
    getActiveSite: async () => ({
      org,
      repo,
      previewUrl: 'https://main--id--davidnuescheler.aem.page',
    }),
    getSyncFolder: async () => syncFolder,
    headHtmlCache: createHeadHtmlCache(),
  });
  const originalResolve = server.headHtmlCache.resolve.bind(server.headHtmlCache);
  server.headHtmlCache.resolve = async (options) => {
    headCalls.push(options.previewUrlOrigin);
    return originalResolve({
      ...options,
      fetchFn: async () => ({
        ok: true,
        text: async () => '<link rel="stylesheet" href="/styles.css"/>',
      }),
    });
  };
  const originalMetadataResolve = server.metadataJsonCache.resolveSheetRow.bind(
    server.metadataJsonCache,
  );
  server.metadataJsonCache.resolveSheetRow = async (options) => {
    metadataCalls.push(options.previewPath);
    return originalMetadataResolve(options);
  };

  try {
    const localResp = await fetch(`${server.baseUrl}/local`);
    assert.equal(localResp.status, 200);
    const localBody = await localResp.text();
    assert.match(localBody, /<meta property="og:title" content="Local page">/);
    assert.match(localBody, /<meta name="keywords" content="sheet-keyword">/);
    assert.doesNotMatch(localBody, /class="metadata"/);
    assert.match(localBody, /<link rel="stylesheet" href="\/styles\.css"\/>/);
    assert.match(localBody, /<main>/);
    assert.equal(headCalls.length, 1);
    assert.deepEqual(metadataCalls, ['/local']);

    const missingResp = await fetch(`${server.baseUrl}/does-not-exist-local`);
    assert.ok(missingResp.status >= 400);
  } finally {
    await server.close();
  }
});

test('preview server returns 503 when no active site', async () => {
  const server = await startPreviewServer({
    getActiveSite: async () => null,
    getSyncFolder: async () => null,
  });

  try {
    const resp = await fetch(`${server.baseUrl}/iba`);
    assert.equal(resp.status, 503);
  } finally {
    await server.close();
  }
});
