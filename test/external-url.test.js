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
import { isAllowedExternalUrl } from '../src/main/external-url.js';

test('isAllowedExternalUrl allows only http(s)', () => {
  assert.equal(isAllowedExternalUrl('https://www.aem.live/docs'), true);
  assert.equal(isAllowedExternalUrl('http://localhost:3000/'), true);
});

test('isAllowedExternalUrl refuses other protocol handlers', () => {
  for (const url of [
    'file:///etc/passwd',
    'smb://server/share',
    'ssh://host',
    'ftp://host/x',
    'mailto:a@b.com',
    'javascript:alert(1)', // eslint-disable-line no-script-url
    'data:text/html,<script>alert(1)</script>',
    'rce.terminal://x',
  ]) {
    assert.equal(isAllowedExternalUrl(url), false, `${url} must be refused`);
  }
});

test('isAllowedExternalUrl refuses non-strings and garbage', () => {
  assert.equal(isAllowedExternalUrl(undefined), false);
  assert.equal(isAllowedExternalUrl(null), false);
  assert.equal(isAllowedExternalUrl(''), false);
  assert.equal(isAllowedExternalUrl('not a url'), false);
  assert.equal(isAllowedExternalUrl(42), false);
});
