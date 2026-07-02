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
import { buildDaLiveListUrl, buildDaLiveSourceUrl } from '../src/main/da-live-api.js';

test('da.live URL builders', () => {
  assert.equal(
    buildDaLiveListUrl('owner', 'site', '/'),
    'https://admin.da.live/list/owner/site/',
  );
  assert.equal(
    buildDaLiveSourceUrl('owner', 'site', '/blog/post.html'),
    'https://admin.da.live/source/owner/site/blog/post.html',
  );
});
