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
import { appDesktopUserAgent } from '../src/main/user-agent.js';

test('appDesktopUserAgent appends the product token to the base UA', () => {
  const base = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Electron/42 Safari/537.36';
  assert.equal(appDesktopUserAgent(base, '1.14.0'), `${base} AEM-Desktop/1.14.0`);
});

test('appDesktopUserAgent is idempotent (no double token)', () => {
  const base = 'Mozilla/5.0 Chrome/130';
  const once = appDesktopUserAgent(base, '1.14.0');
  assert.equal(appDesktopUserAgent(once, '1.14.0'), once);
});

test('appDesktopUserAgent handles empty base and missing version', () => {
  assert.equal(appDesktopUserAgent('', '1.14.0'), 'AEM-Desktop/1.14.0');
  assert.equal(appDesktopUserAgent(undefined, undefined), 'AEM-Desktop/0.0.0');
});
