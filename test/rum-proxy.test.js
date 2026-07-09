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
  rewriteRumBeaconBody,
  shouldRewriteRumReferer,
  startRumProxy,
} from '../src/main/rum-proxy.js';
import { DESKTOP_RUM_ORIGIN } from '../src/rum-config.js';

test('shouldRewriteRumReferer keeps desktop referers', () => {
  assert.equal(
    shouldRewriteRumReferer(`${DESKTOP_RUM_ORIGIN}/sites/org/repo`),
    false,
  );
});

test('shouldRewriteRumReferer rewrites file and localhost referers', () => {
  assert.equal(shouldRewriteRumReferer('file:///index.html'), true);
  assert.equal(shouldRewriteRumReferer('http://127.0.0.1:4567/'), true);
  assert.equal(shouldRewriteRumReferer(''), true);
});

test('rewriteRumBeaconBody preserves cooperative desktop referer', () => {
  const referer = `${DESKTOP_RUM_ORIGIN}/sites/org/repo/content/blog/post`;
  const input = JSON.stringify({
    weight: 100,
    id: 'abc',
    referer,
    checkpoint: 'top',
    t: 12,
  });
  const out = rewriteRumBeaconBody(input, `${DESKTOP_RUM_ORIGIN}/`);
  assert.equal(out.body, input);
  assert.equal(out.referer, referer);
});

test('rewriteRumBeaconBody rewrites file referer to fallback', () => {
  const input = JSON.stringify({
    weight: 100,
    id: 'abc',
    referer: 'file:///renderer/index.html',
    checkpoint: 'click',
    t: 42,
  });
  const fallback = `${DESKTOP_RUM_ORIGIN}/sites/org/repo`;
  const out = rewriteRumBeaconBody(input, fallback);
  const payload = JSON.parse(out.body);
  assert.equal(payload.referer, fallback);
  assert.equal(out.referer, fallback);
});

test('rum proxy forwards GET script requests to rum.hlx.page', async () => {
  let upstreamUrl;
  const proxy = await startRumProxy({
    fetchFn: async (url) => {
      upstreamUrl = url;
      return new Response('// rum', {
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      });
    },
  });

  try {
    const resp = await fetch(
      `${proxy.baseUrl}/.rum/@adobe/helix-rum-js@2/dist/rum-standalone.js`,
    );
    assert.equal(resp.status, 200);
    assert.match(upstreamUrl, /^https:\/\/rum\.hlx\.page\/\.rum\//);
  } finally {
    await proxy.close();
  }
});

test('rum proxy rewrites beacon referer in JSON body but not HTTP Referer header', async () => {
  /** @type {Record<string, string>|undefined} */
  let forwardedHeaders;
  /** @type {string|undefined} */
  let forwardedBody;
  const proxy = await startRumProxy({
    fetchFn: async (_url, init) => {
      forwardedHeaders = init?.headers;
      forwardedBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(null, { status: 201 });
    },
  });

  try {
    const cooperativeReferer = `${DESKTOP_RUM_ORIGIN}/sites/org/repo/content/page`;
    const resp = await fetch(`${proxy.baseUrl}/.rum/100`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        weight: 100,
        id: 'abc',
        referer: cooperativeReferer,
        checkpoint: 'top',
        t: 1,
      }),
    });
    assert.equal(resp.status, 201);
    assert.equal(forwardedHeaders?.referer, undefined);
    assert.equal(JSON.parse(forwardedBody || '{}').referer, cooperativeReferer);

    const clickResp = await fetch(`${proxy.baseUrl}/.rum/100`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        weight: 100,
        id: 'abc',
        referer: 'file:///index.html',
        checkpoint: 'click',
        t: 2,
      }),
    });
    assert.equal(clickResp.status, 201);
    assert.equal(forwardedHeaders?.referer, undefined);
    assert.equal(JSON.parse(forwardedBody || '{}').referer, cooperativeReferer);
  } finally {
    await proxy.close();
  }
});
