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
  parsePreviewRef,
  buildAdminLoginUrl,
  siteTokenEntryFromMessage,
  isAllowedLoginNavigation,
  adminBaseForApiBackend,
} from '../src/main/preview-login-url.js';
import { API_BACKEND_AEM_API } from '../src/main/content-api-shared.js';

test('parsePreviewRef extracts the ref from the preview host', () => {
  assert.equal(
    parsePreviewRef('https://main--it-waters-website--waterscorporation.aem.page'),
    'main',
  );
  assert.equal(
    parsePreviewRef('https://feature-x--repo--org.aem.page/some/path'),
    'feature-x',
  );
});

test('parsePreviewRef defaults to main on unexpected input', () => {
  assert.equal(parsePreviewRef('not a url'), 'main');
  assert.equal(parsePreviewRef('https://example.com'), 'main');
});

test('buildAdminLoginUrl targets admin login with optional extensionId', () => {
  assert.equal(
    buildAdminLoginUrl({ org: 'org', site: 'site', ref: 'main' }),
    'https://admin.hlx.page/login/org/site/main',
  );
  assert.equal(
    buildAdminLoginUrl({
      org: 'org', site: 'site', ref: 'main', extensionId: 'abc',
    }),
    'https://admin.hlx.page/login/org/site/main?extensionId=abc',
  );
});

test('buildAdminLoginUrl uses api.aem.live query form for helix6 backend', () => {
  assert.equal(
    adminBaseForApiBackend(API_BACKEND_AEM_API),
    'https://api.aem.live',
  );
  assert.equal(
    buildAdminLoginUrl({
      org: 'org',
      site: 'site',
      ref: 'main',
      adminBase: adminBaseForApiBackend(API_BACKEND_AEM_API),
      extensionId: 'abc',
    }),
    'https://api.aem.live/login?org=org&site=site&extensionId=abc',
  );
});

test('siteTokenEntryFromMessage extracts token and converts expiry to ms', () => {
  assert.deepEqual(
    siteTokenEntryFromMessage({ siteToken: 'hlx_abc', siteTokenExpiry: 1000 }),
    { token: 'hlx_abc', expiresAt: 1000 * 1000 },
  );
  assert.deepEqual(
    siteTokenEntryFromMessage({ token: 'hlx_def' }),
    { token: 'hlx_def', expiresAt: null },
  );
});

test('siteTokenEntryFromMessage returns null without a site token', () => {
  assert.equal(siteTokenEntryFromMessage({ authToken: 'admin-only' }), null);
  assert.equal(siteTokenEntryFromMessage(null), null);
  assert.equal(siteTokenEntryFromMessage({ siteToken: 123 }), null);
});

test('isAllowedLoginNavigation permits admin + Adobe IdP origins over https', () => {
  assert.equal(isAllowedLoginNavigation('https://admin.hlx.page/login/o/s/main'), true);
  assert.equal(isAllowedLoginNavigation('https://ims-na1.adobelogin.com/ims/authorize/v2'), true);
  assert.equal(isAllowedLoginNavigation('https://auth.services.adobe.com/en_US/index.html'), true);
  assert.equal(isAllowedLoginNavigation('https://login.microsoftonline.com/x'), true);
});

test('isAllowedLoginNavigation rejects other origins, http, and junk', () => {
  assert.equal(isAllowedLoginNavigation('https://evil.example.com/'), false);
  // suffix must be on a dot boundary, not a substring match
  assert.equal(isAllowedLoginNavigation('https://notadobe.com/'), false);
  assert.equal(isAllowedLoginNavigation('https://adobe.com.evil.com/'), false);
  assert.equal(isAllowedLoginNavigation('http://admin.hlx.page/'), false);
  assert.equal(isAllowedLoginNavigation('not a url'), false);
});
