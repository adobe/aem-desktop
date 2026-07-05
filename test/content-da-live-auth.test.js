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
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_DA_LIVE_HOST,
  createDaBearerTokenResolver,
  isContentDaLiveUrl,
  loadStoredDaBearerToken,
  withDaBearerAuth,
} from '../src/main/content-da-live-auth.js';

test('isContentDaLiveUrl matches content.da.live only', () => {
  assert.equal(isContentDaLiveUrl('https://content.da.live/adobe/da-bacom/media/hero.png'), true);
  assert.equal(isContentDaLiveUrl('https://admin.da.live/source/org/repo/hero.png'), false);
  assert.equal(isContentDaLiveUrl('https://main--site--org.aem.page/hero.png'), false);
  assert.equal(isContentDaLiveUrl('not-a-url'), false);
});

test('withDaBearerAuth sets Authorization header', () => {
  const headers = withDaBearerAuth({ accept: 'image/*' }, 'abc123');
  assert.equal(headers.accept, 'image/*');
  assert.equal(headers.Authorization, 'Bearer abc123');
});

test('loadStoredDaBearerToken returns a valid stored token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'da-bearer-'));
  const tokenPath = join(dir, '.da-token.json');
  await writeFile(tokenPath, `${JSON.stringify({
    access_token: 'stored-token',
    expires_at: Date.now() + 3600_000,
  })}\n`);

  const token = await loadStoredDaBearerToken(tokenPath);
  assert.equal(token, 'stored-token');
});

test('createDaBearerTokenResolver caches token reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'da-bearer-cache-'));
  const tokenPath = join(dir, '.da-token.json');
  await writeFile(tokenPath, `${JSON.stringify({
    access_token: 'cached-token',
    expires_at: Date.now() + 3600_000,
  })}\n`);

  const resolver = createDaBearerTokenResolver(tokenPath);
  assert.equal(await resolver.getToken(), 'cached-token');

  await writeFile(tokenPath, `${JSON.stringify({
    access_token: 'rotated-token',
    expires_at: Date.now() + 3600_000,
  })}\n`);
  assert.equal(await resolver.getToken(), 'cached-token');

  resolver.clearCache();
  assert.equal(await resolver.getToken(), 'rotated-token');
});

test('CONTENT_DA_LIVE_HOST is content.da.live', () => {
  assert.equal(CONTENT_DA_LIVE_HOST, 'content.da.live');
});
