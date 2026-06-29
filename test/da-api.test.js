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
  API_BACKEND_AEM_API,
  API_BACKEND_DA_LIVE,
  buildAemApiListUrl,
  buildAemApiSourceUrl,
  buildDaLiveListUrl,
  buildDaLiveSourceUrl,
  buildPostUploadRequest,
  DaClient,
  normalizeAemApiListEntry,
  normalizeDaPath,
  toApiRelativePath,
} from '../src/main/da-api.js';
import { composeHttpErrorMessage } from '../src/main/http-request-error.js';

test('composeHttpErrorMessage includes x-error header', () => {
  const message = composeHttpErrorMessage({
    method: 'PUT',
    url: 'https://api.aem.live/org/sites/site/source/foo.html',
    status: 400,
    statusText: 'Bad Request',
    context: 'Upload failed for /foo.html',
    xError: 'Invalid path format',
    bodyDetail: 'path must end with .html',
  });
  assert.match(message, /x-error: Invalid path format/);
  assert.match(message, /400 Bad Request/);
});

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

test('uploadSource retries with POST when PUT returns 400', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    if (init.method === 'PUT') {
      return new Response('rejected', {
        status: 400,
        headers: { 'x-error': 'external images are not allowed' },
      });
    }
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'text/html');
    return new Response('', { status: 201 });
  };
  const client = new DaClient('token', API_BACKEND_AEM_API, fetchImpl);
  await client.uploadSource(
    'org',
    'site',
    '/page.html',
    Buffer.from('<img src="https://example.com/x">'),
    'text/html',
  );
  assert.equal(calls, 2);
});

test('uploadSource does not retry POST when PUT returns non-400', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('forbidden', { status: 403 });
  };
  const client = new DaClient('token', API_BACKEND_AEM_API, fetchImpl);
  await assert.rejects(
    () => client.uploadSource('org', 'site', '/page.html', Buffer.from('x'), 'text/html'),
    /403/,
  );
  assert.equal(calls, 1);
});

test('uploadSource uses multipart POST for da.live on PUT 400', async () => {
  const fetchImpl = async (_url, init) => {
    if (init.method === 'PUT') {
      return new Response('', { status: 400 });
    }
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof FormData);
    return new Response('{}', { status: 201 });
  };
  const client = new DaClient('token', API_BACKEND_DA_LIVE, fetchImpl);
  await client.uploadSource('org', 'site', '/test.html', Buffer.from('<p>hi</p>'), 'text/html');
});

test('buildPostUploadRequest sets filename from daPath for da.live', () => {
  const { body } = buildPostUploadRequest(
    API_BACKEND_DA_LIVE,
    Buffer.from('x'),
    'text/html',
    '/blog/post.html',
  );
  assert.ok(body instanceof FormData);
});
