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
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAuthErrorHtml,
  buildSiteLoginAckUrl,
  buildSiteLoginUrl,
  createSiteLoginSession,
  getStoredSiteToken,
  isValidSiteTokenFormat,
  saveSiteToken,
  siteAuthKey,
  siteAuthRequestHeaders,
} from '../src/main/site-auth.js';
import { API_BACKEND_AEM_API } from '../src/main/content-api-shared.js';

test('siteAuthRequestHeaders adds Authorization token header', () => {
  assert.deepEqual(
    siteAuthRequestHeaders('hlxtst_example'),
    { authorization: 'token hlxtst_example' },
  );
  assert.deepEqual(siteAuthRequestHeaders(null), {});
});

test('buildSiteLoginUrl uses legacy admin path by default', () => {
  const url = buildSiteLoginUrl({
    org: 'owner',
    repo: 'site',
    branch: 'main',
    ackUrl: 'http://127.0.0.1:1234/.aem/cli/login/ack',
  });
  assert.match(
    url,
    /^https:\/\/admin\.hlx\.page\/login\/owner\/site\/main\?client_id=aem-cli&redirect_uri=/,
  );
  assert.match(url, /selectAccount=true/);
});

test('buildSiteLoginUrl uses api.aem.live for helix6 backend', () => {
  const url = buildSiteLoginUrl({
    org: 'owner',
    repo: 'site',
    apiBackend: API_BACKEND_AEM_API,
    ackUrl: 'http://127.0.0.1:1234/.aem/cli/login/ack',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.aem.live');
  assert.equal(parsed.pathname, '/login');
  assert.equal(parsed.searchParams.get('org'), 'owner');
  assert.equal(parsed.searchParams.get('site'), 'site');
});

test('buildAuthErrorHtml wraps plain auth errors for sidekick detection', () => {
  const html = buildAuthErrorHtml(401, 'https://main--site--owner.aem.page/');
  assert.match(html, /<pre[^>]*>401 Unauthorized<\/pre>/);
  assert.match(html, /hlx:proxyUrl/);
});

test('createSiteLoginSession validates state and returns site token', async () => {
  const session = createSiteLoginSession();
  session.createState();
  const loginUrl = session.buildLoginRedirectUrl(
    'https://admin.hlx.page/login/o/s/main?client_id=aem-cli',
  );
  assert.match(loginUrl, /state=/);

  const bad = await session.handleAck({
    method: 'POST',
    origin: 'https://admin.hlx.page',
    body: { state: 'wrong', siteToken: 'hlxtst_ok' },
  });
  assert.equal(bad.status, 400);

  const nextState = session.createState();
  const ok = await session.handleAck({
    method: 'POST',
    origin: 'https://admin.hlx.page',
    body: { state: nextState, siteToken: 'hlxtst_ok' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.siteToken, 'hlxtst_ok');
});

test('saveSiteToken persists per org/repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-site-auth-'));
  const storePath = join(dir, 'tokens.json');
  assert.equal(isValidSiteTokenFormat('hlxtst_abc'), true);
  assert.equal(isValidSiteTokenFormat('bad'), false);

  await saveSiteToken(storePath, 'owner', 'site', 'hlxtst_abc');
  const token = await getStoredSiteToken(storePath, 'owner', 'site');
  assert.equal(token, 'hlxtst_abc');
  assert.equal(siteAuthKey('owner', 'site'), 'owner/site');
});

test('buildSiteLoginAckUrl points at cli ack route', () => {
  assert.equal(
    buildSiteLoginAckUrl('http://127.0.0.1:4567'),
    'http://127.0.0.1:4567/.aem/cli/login/ack',
  );
});
