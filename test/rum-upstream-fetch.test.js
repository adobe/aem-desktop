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
import { rumUpstreamFetch } from '../src/main/rum-upstream-fetch.js';

test('rumUpstreamFetch rejects non-rum origins', async () => {
  await assert.rejects(
    () => rumUpstreamFetch('https://example.com/.rum/1'),
    /limited to https:\/\/rum\.hlx\.page/,
  );
});

test('rumUpstreamFetch posts beacons to rum.hlx.page', async () => {
  const body = JSON.stringify({
    weight: 1,
    id: 'test',
    referer: 'https://desktop.aem.live/',
    checkpoint: 'top',
    t: 1,
  });
  const resp = await rumUpstreamFetch('https://rum.hlx.page/.rum/1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal(resp.status, 201);
});
