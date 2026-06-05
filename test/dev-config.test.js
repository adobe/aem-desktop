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
import { resolveCdpPort, screenshotFilename } from '../src/main/dev-config.js';

test('resolveCdpPort defaults to 9223', () => {
  assert.equal(resolveCdpPort({}), 9223);
});

test('resolveCdpPort honors AEM_DESKTOP_CDP_PORT', () => {
  assert.equal(resolveCdpPort({ AEM_DESKTOP_CDP_PORT: '9333' }), 9333);
});

test('resolveCdpPort ignores invalid/out-of-range ports', () => {
  assert.equal(resolveCdpPort({ AEM_DESKTOP_CDP_PORT: 'nope' }), 9223);
  assert.equal(resolveCdpPort({ AEM_DESKTOP_CDP_PORT: '0' }), 9223);
  assert.equal(resolveCdpPort({ AEM_DESKTOP_CDP_PORT: '70000' }), 9223);
});

test('screenshotFilename is timestamped and filesystem-safe', () => {
  const name = screenshotFilename(new Date('2026-06-05T11:22:33.444Z'));
  assert.equal(name, 'aem-desktop-2026-06-05T11-22-33-444Z.png');
  assert.doesNotMatch(name, /[:.](?!png)/);
});
