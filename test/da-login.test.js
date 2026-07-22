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
import { CALLBACK_PORT } from '../src/main/da-auth.js';
import { isAllowedDaLoginNavigation } from '../src/main/da-login-url.js';

test('isAllowedDaLoginNavigation allows OAuth callback on localhost', () => {
  assert.equal(
    isAllowedDaLoginNavigation(`http://localhost:${CALLBACK_PORT}/callback`),
    true,
  );
});

test('isAllowedDaLoginNavigation allows Adobe IMS and IdP hosts', () => {
  assert.equal(isAllowedDaLoginNavigation('https://ims-na1.adobelogin.com/ims/authorize/v2'), true);
  assert.equal(isAllowedDaLoginNavigation('https://auth.services.adobe.com/en_US/index.html'), true);
});

test('isAllowedDaLoginNavigation rejects arbitrary hosts', () => {
  assert.equal(isAllowedDaLoginNavigation('https://evil.example/phish'), false);
  assert.equal(isAllowedDaLoginNavigation('http://127.0.0.1:9898/callback'), false);
});
