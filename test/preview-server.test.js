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
    // Keep the test offline: the auth probe HEAD must not hit the real .aem.page origin.
    fetchFn: async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
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

test('preview server notifies onAuthRequired for upstream 401', async () => {
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  let authRequired = 0;
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    getToken: async () => null,
    onAuthRequired: () => {
      authRequired += 1;
    },
    fetchFn: async () => new Response('401 Unauthorized', {
      status: 401,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  try {
    const resp = await fetch(`${server.baseUrl}/protected`);
    assert.equal(resp.status, 401);
    assert.equal(authRequired, 1);
  } finally {
    await server.close();
  }
});

test('preview server notifies onAuthRequired for upstream 403 without token', async () => {
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  let authRequired = 0;
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    getToken: async () => null,
    onAuthRequired: () => {
      authRequired += 1;
    },
    fetchFn: async () => new Response('403 Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  try {
    const resp = await fetch(`${server.baseUrl}/protected`);
    assert.equal(resp.status, 403);
    assert.equal(authRequired, 1);
  } finally {
    await server.close();
  }
});

test('preview server strips localhost Origin before upstream fetch', async () => {
  let forwardedOrigin;
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    getToken: async () => null,
    fetchFn: async (_url, init) => {
      forwardedOrigin = init?.headers?.origin;
      return new Response('ok', { status: 200 });
    },
  });

  try {
    await fetch(`${server.baseUrl}/page`, {
      headers: { Origin: 'http://127.0.0.1:9999' },
    });
    assert.equal(forwardedOrigin, undefined);
  } finally {
    await server.close();
  }
});

test('preview server strips localhost Referer before upstream fetch', async () => {
  let forwardedReferer;
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    getToken: async () => null,
    fetchFn: async (_url, init) => {
      forwardedReferer = init?.headers?.referer;
      return new Response('ok', { status: 200 });
    },
  });

  try {
    // Chromium's net.fetch rejects a Referer that doesn't match the upstream
    // destination with net::ERR_BLOCKED_BY_CLIENT, so it must never forward.
    await fetch(`${server.baseUrl}/styles/styles.css`, {
      headers: { Referer: 'http://127.0.0.1:9999/some/page' },
    });
    assert.equal(forwardedReferer, undefined);
  } finally {
    await server.close();
  }
});

test('preview server proxies to the site previewUrl origin (aem.page not aem.live)', async () => {
  let upstreamUrl;
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    fetchFn: async (url) => {
      upstreamUrl = url;
      return new Response('ok', { status: 200 });
    },
  });

  try {
    await fetch(`${server.baseUrl}/hello`);
    assert.equal(upstreamUrl, 'https://main--id--org.aem.page/hello');
  } finally {
    await server.close();
  }
});

test('preview server falls through to proxy when local file exists but upstream requires auth', async () => {
  const syncFolder = await mkdtemp(join(tmpdir(), 'aem-sync-auth-'));
  const org = 'org';
  const repo = 'id';
  const contentRoot = join(syncFolder, org, repo);
  await mkdir(contentRoot, { recursive: true });
  await writeFile(join(contentRoot, 'protected.html'), '<h1>Local only</h1>');

  let authRequired = 0;
  let proxyCalled = false;
  const site = {
    org,
    repo,
    previewUrl: 'https://main--id--org.aem.page',
  };
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => syncFolder,
    getToken: async () => null,
    onAuthRequired: () => {
      authRequired += 1;
    },
    fetchFn: async (url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 401 });
      }
      proxyCalled = true;
      return new Response('401 Unauthorized', { status: 401 });
    },
  });

  try {
    const resp = await fetch(`${server.baseUrl}/protected`);
    assert.equal(resp.status, 401);
    assert.equal(proxyCalled, true);
    assert.equal(authRequired, 1);
    const body = await resp.text();
    assert.doesNotMatch(body, /Local only/);
  } finally {
    await server.close();
  }
});

test('preview server sends Authorization token header upstream', async () => {
  let authHeader;
  const site = {
    org: 'org',
    repo: 'id',
    previewUrl: 'https://main--id--org.aem.page',
  };
  const server = await startPreviewServer({
    getActiveSite: async () => site,
    getSyncFolder: async () => null,
    getToken: async () => 'hlxtst_secret',
    fetchFn: async (_url, init) => {
      authHeader = init?.headers?.authorization;
      return new Response('ok', { status: 200 });
    },
  });

  try {
    const resp = await fetch(`${server.baseUrl}/page`);
    assert.equal(resp.status, 200);
    assert.equal(authHeader, 'token hlxtst_secret');
  } finally {
    await server.close();
  }
});
