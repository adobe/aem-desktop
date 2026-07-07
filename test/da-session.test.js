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
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearDaAuthStorage,
  DA_AUTH_STORAGE_ORIGINS,
  DA_AUTH_STORAGE_TYPES,
  decodeImsTokenClaims,
  describeTokenDiagnostics,
  invalidateDaSession,
  resolveStoredAccessToken,
} from '../src/main/da-session.js';
import { saveToken } from '../src/main/da-auth.js';
import { DA_UNAUTHORIZED_MESSAGE } from '../src/main/content-api-shared.js';
import { PREVIEW_WEBVIEW_PARTITION } from '../src/main/content-da-live-auth.js';
import { loadSiteTokens } from '../src/main/site-token-store.js';

function fakeJwt(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

function fakeElectronSession() {
  const calls = [];
  return {
    calls,
    defaultSession: {
      clearStorageData: async (options) => {
        calls.push({ partition: 'default', options });
      },
    },
    fromPartition: (partition) => ({
      clearStorageData: async (options) => {
        calls.push({ partition, options });
      },
    }),
  };
}

test('resolveStoredAccessToken explains a missing token file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-session-'));
  const tokenPath = join(dir, '.da-token.json');

  await assert.rejects(
    () => resolveStoredAccessToken(tokenPath),
    (err) => {
      assert.match(err.message, new RegExp(DA_UNAUTHORIZED_MESSAGE));
      assert.ok(err.message.includes(tokenPath));
      return true;
    },
  );
});

test('resolveStoredAccessToken explains an expired token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-session-'));
  const tokenPath = join(dir, '.da-token.json');
  const expiresAt = Date.now() - 1000;
  await saveToken(tokenPath, { access_token: 'stale', expires_at: expiresAt });

  await assert.rejects(
    () => resolveStoredAccessToken(tokenPath),
    (err) => {
      assert.match(err.message, new RegExp(DA_UNAUTHORIZED_MESSAGE));
      assert.ok(err.message.includes(new Date(expiresAt).toISOString()));
      return true;
    },
  );
});

test('resolveStoredAccessToken returns a valid token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-session-'));
  const tokenPath = join(dir, '.da-token.json');
  await saveToken(tokenPath, { access_token: 'good', expires_at: Date.now() + 3600_000 });

  assert.equal(await resolveStoredAccessToken(tokenPath), 'good');
});

test('decodeImsTokenClaims decodes a JWT payload and rejects garbage', () => {
  const claims = { user_id: 'ABC@AdobeID', client_id: 'darkalley' };
  assert.deepEqual(decodeImsTokenClaims(fakeJwt(claims)), claims);
  assert.equal(decodeImsTokenClaims('not-a-jwt'), null);
  assert.equal(decodeImsTokenClaims(''), null);
});

test('describeTokenDiagnostics summarizes claims without leaking the token', () => {
  const createdAt = Date.UTC(2026, 0, 2, 3, 4, 5);
  const token = fakeJwt({
    user_id: 'ABC@AdobeID',
    client_id: 'darkalley',
    created_at: String(createdAt),
    expires_in: '86400000',
  });
  const storedExpiry = createdAt + 86_400_000;

  const text = describeTokenDiagnostics({ access_token: token, expires_at: storedExpiry });

  assert.ok(text.includes('client_id=darkalley'));
  assert.ok(text.includes('user=ABC@AdobeID'));
  assert.ok(text.includes(new Date(createdAt).toISOString()));
  assert.ok(text.includes(new Date(storedExpiry).toISOString()));
  assert.ok(!text.includes(token));
});

test('describeTokenDiagnostics handles missing and opaque tokens', () => {
  assert.equal(describeTokenDiagnostics(null), 'no stored token');
  assert.equal(describeTokenDiagnostics({}), 'no stored token');
  assert.equal(
    describeTokenDiagnostics({ access_token: 'opaque' }),
    'token present but not a decodable JWT',
  );
});

test('clearDaAuthStorage clears default session and given partitions', async () => {
  const ses = fakeElectronSession();

  await clearDaAuthStorage(ses, [PREVIEW_WEBVIEW_PARTITION, 'persist:aem-preview-login']);

  const partitions = ses.calls.map((c) => c.partition);
  assert.deepEqual(
    partitions.sort(),
    ['default', PREVIEW_WEBVIEW_PARTITION, 'persist:aem-preview-login'].sort(),
  );
  for (const call of ses.calls) {
    assert.deepEqual(call.options.origins, DA_AUTH_STORAGE_ORIGINS);
    assert.deepEqual(call.options.storages, DA_AUTH_STORAGE_TYPES);
  }
});

test('invalidateDaSession removes every stored and cached credential', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-session-'));
  const tokenPath = join(dir, '.da-token.json');
  const siteTokensPath = join(dir, '.site-tokens.json');
  await saveToken(tokenPath, { access_token: 'tok', expires_at: Date.now() + 3600_000 });
  await writeFile(
    siteTokensPath,
    JSON.stringify({ 'https://main--site--org.aem.page': { token: 'site-tok', expiresAt: null } }),
    'utf8',
  );

  const ses = fakeElectronSession();
  const called = { content: 0, preview: 0, siteCache: 0 };

  await invalidateDaSession({
    tokenPath,
    siteTokensPath,
    electronSession: ses,
    partitions: [PREVIEW_WEBVIEW_PARTITION, 'persist:aem-preview-login'],
    clearContentAuthCache: () => { called.content += 1; },
    clearPreviewCaches: () => { called.preview += 1; },
    resetSiteTokensCache: () => { called.siteCache += 1; },
  });

  await assert.rejects(() => readFile(tokenPath, 'utf8'));
  assert.deepEqual(await loadSiteTokens(siteTokensPath), {});
  assert.deepEqual(called, { content: 1, preview: 1, siteCache: 1 });
  assert.equal(ses.calls.length, 3);
});

test('invalidateDaSession tolerates a missing token file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-session-'));

  await invalidateDaSession({ tokenPath: join(dir, '.da-token.json') });
});
