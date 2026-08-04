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
  describeRequestUrl, formatRequestLogLine, withRequestLogging,
} from '../src/main/http-log.js';

test('describeRequestUrl drops protocol and keeps path + query', () => {
  assert.equal(
    describeRequestUrl('https://api.aem.live/o/sites/r/source/index.html?x=1'),
    'api.aem.live/o/sites/r/source/index.html?x=1',
  );
  assert.equal(describeRequestUrl('not a url'), 'not a url');
});

test('formatRequestLogLine formats success and error lines', () => {
  assert.equal(
    formatRequestLogLine({
      seq: 3, method: 'GET', url: 'https://api.aem.live/a', status: 200, ms: 42,
    }),
    '#3 GET api.aem.live/a → 200 (42ms)',
  );
  assert.equal(
    formatRequestLogLine({
      seq: 4, method: 'POST', url: 'https://api.aem.live/b', ms: 5, error: 'boom',
    }),
    '#4 POST api.aem.live/b → ERR boom (5ms)',
  );
});

test('withRequestLogging numbers requests and routes 429 to warn', async () => {
  const lines = { info: [], warn: [], error: [] };
  const logger = {
    info: (l) => lines.info.push(l),
    warn: (l) => lines.warn.push(l),
    error: (l) => lines.error.push(l),
  };
  let clock = 0;
  const tick = () => {
    clock += 10;
    return clock;
  };
  const fetchImpl = async (url) => new Response('', {
    status: String(url).includes('busy') ? 429 : 200,
  });
  const wrapped = withRequestLogging(fetchImpl, { logger, enabled: true, clock: tick });

  await wrapped('https://api.aem.live/ok');
  await wrapped('https://api.aem.live/busy');

  assert.equal(lines.info.length, 1);
  assert.match(lines.info[0], /^#1 GET api\.aem\.live\/ok → 200/);
  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /^#2 GET api\.aem\.live\/busy → 429/);
});

test('withRequestLogging returns the original fetch when disabled', () => {
  const fetchImpl = async () => new Response('');
  assert.equal(withRequestLogging(fetchImpl, { logger: {}, enabled: false }), fetchImpl);
});

test('withRequestLogging logs and rethrows on network error', async () => {
  const lines = [];
  const logger = { info() {}, warn() {}, error: (l) => lines.push(l) };
  const wrapped = withRequestLogging(
    async () => { throw new Error('offline'); },
    { logger, enabled: true, clock: () => 0 },
  );
  await assert.rejects(wrapped('https://api.aem.live/x'), /offline/);
  assert.match(lines[0], /ERR offline/);
});
