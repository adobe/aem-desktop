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
  isDaUnauthorizedError,
} from '../src/main/content-api-shared.js';
import { ContentApiClient } from '../src/main/content-api-client.js';
import {
  buildFetchFailureError,
  composeHttpErrorMessage,
  describeErrorChain,
  HttpRequestError,
} from '../src/main/http-request-error.js';

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

test('describeErrorChain flattens nested fetch failure causes', () => {
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND admin.da.live'), {
    code: 'ENOTFOUND',
  });
  const fetchFailed = new TypeError('fetch failed', { cause: dns });

  assert.equal(
    describeErrorChain(fetchFailed),
    'fetch failed ← getaddrinfo ENOTFOUND admin.da.live',
  );
  assert.equal(describeErrorChain(new Error('boom')), 'boom');
  assert.equal(describeErrorChain(null), 'unknown error');
});

test('network failures name the request and underlying cause', async () => {
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND admin.da.live'), {
    code: 'ENOTFOUND',
  });
  const fetchImpl = async () => {
    throw new TypeError('fetch failed', { cause: dns });
  };
  const client = new ContentApiClient('token', API_BACKEND_DA_LIVE, fetchImpl);

  await assert.rejects(
    () => client.list('org', 'site', '/'),
    (err) => {
      assert.ok(err instanceof HttpRequestError);
      assert.match(err.message, /Network request failed: GET https:\/\/admin\.da\.live\/list\/org\/site\//);
      assert.match(err.message, /getaddrinfo ENOTFOUND admin\.da\.live/);
      assert.match(err.message, /network, VPN, or proxy/);
      assert.ok(!isDaUnauthorizedError(err));
      return true;
    },
  );
});

test('buildFetchFailureError appends network context when provided', () => {
  const err = buildFetchFailureError(
    'GET',
    'https://admin.da.live/list/org/site/',
    new Error('net::ERR_PROXY_CONNECTION_FAILED'),
    'online; proxy: PROXY proxy.example.com:8080; app 1.6.2, electron 33.0.0',
  );

  assert.match(err.message, /net::ERR_PROXY_CONNECTION_FAILED/);
  assert.match(err.message, /\[online; proxy: PROXY proxy\.example\.com:8080; app 1\.6\.2, electron 33\.0\.0\]/);
  assert.match(err.message, /network, VPN, or proxy/);
});

test('pre-enriched network errors from the injected fetch are not re-wrapped', async () => {
  const enriched = buildFetchFailureError(
    'GET',
    'https://admin.da.live/list/org/site/',
    new Error('net::ERR_NAME_NOT_RESOLVED'),
    'no network connection; proxy: DIRECT',
  );
  const fetchImpl = async () => {
    throw enriched;
  };
  const client = new ContentApiClient('token', API_BACKEND_DA_LIVE, fetchImpl);

  await assert.rejects(
    () => client.list('org', 'site', '/'),
    (err) => {
      assert.equal(err, enriched);
      assert.equal(
        (err.message.match(/Network request failed/g) || []).length,
        1,
        'context must not be wrapped twice',
      );
      return true;
    },
  );
});

test('401 errors keep the unauthorized prefix and carry request detail', async () => {
  const fetchImpl = async () => new Response('token rejected', {
    status: 401,
    statusText: 'Unauthorized',
    headers: { 'x-error': 'IMS token validation failed' },
  });
  const client = new ContentApiClient('token', API_BACKEND_DA_LIVE, fetchImpl);

  await assert.rejects(
    () => client.list('org', 'site', '/'),
    (err) => {
      assert.ok(isDaUnauthorizedError(err));
      assert.ok(err instanceof HttpRequestError);
      assert.equal(err.status, 401);
      assert.match(err.message, /GET https:\/\/admin\.da\.live\/list\/org\/site\//);
      assert.match(err.message, /x-error: IMS token validation failed/);
      assert.match(err.message, /token rejected/);
      return true;
    },
  );
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
  const client = new ContentApiClient('token', API_BACKEND_AEM_API, fetchImpl);
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
  const client = new ContentApiClient('token', API_BACKEND_AEM_API, fetchImpl);
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
  const client = new ContentApiClient('token', API_BACKEND_DA_LIVE, fetchImpl);
  await client.uploadSource('org', 'site', '/test.html', Buffer.from('<p>hi</p>'), 'text/html');
});
