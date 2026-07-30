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
  AEM_ADMIN_MIN_INTERVAL_MS,
  AEM_ADMIN_TARGET_RPS,
  computeBackoffDelayMs,
  parseRetryAfterMs,
  RATE_LIMIT_MAX_RETRIES,
  withRateLimitRetry,
  withRequestPacer,
} from '../src/main/http-rate-limit.js';

test('AEM admin pacer targets under 10 req/s', () => {
  assert.equal(AEM_ADMIN_TARGET_RPS, 8);
  assert.equal(AEM_ADMIN_MIN_INTERVAL_MS, 125);
});

test('parseRetryAfterMs reads delta-seconds', () => {
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('0'), 0);
  assert.equal(parseRetryAfterMs('1.5'), 1500);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(''), null);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
});

test('parseRetryAfterMs reads HTTP-date relative to now', () => {
  const now = Date.parse('Wed, 29 Jul 2026 12:00:00 GMT');
  const later = 'Wed, 29 Jul 2026 12:00:03 GMT';
  assert.equal(parseRetryAfterMs(later, now), 3000);
  const past = 'Wed, 29 Jul 2026 11:59:59 GMT';
  assert.equal(parseRetryAfterMs(past, now), 0);
});

test('computeBackoffDelayMs prefers Retry-After', () => {
  assert.equal(computeBackoffDelayMs(0, { retryAfterMs: 2500, random: () => 0 }), 2500);
  assert.equal(computeBackoffDelayMs(0, { retryAfterMs: 0, random: () => 0 }), 0);
});

test('computeBackoffDelayMs uses exponential backoff without Retry-After', () => {
  assert.equal(computeBackoffDelayMs(0, { random: () => 0 }), 1000);
  assert.equal(computeBackoffDelayMs(1, { random: () => 0 }), 2000);
  assert.equal(computeBackoffDelayMs(2, { random: () => 0 }), 4000);
});

test('withRateLimitRetry retries 429 then succeeds', async () => {
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('slow down', {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
    }
    return new Response('[]', { status: 200 });
  };
  const wrapped = withRateLimitRetry(fetchImpl, {
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
  });
  const res = await wrapped('https://api.aem.live/x');
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
});

test('withRateLimitRetry stops after max retries', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('nope', { status: 429 });
  };
  const wrapped = withRateLimitRetry(fetchImpl, {
    maxRetries: 2,
    sleepFn: async () => {},
    onRetry: () => {},
  });
  const res = await wrapped('https://api.aem.live/x');
  assert.equal(res.status, 429);
  // initial attempt + 2 retries
  assert.equal(calls, 3);
  assert.equal(RATE_LIMIT_MAX_RETRIES, 5);
});

test('withRateLimitRetry does not retry non-429', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('forbidden', { status: 403 });
  };
  const wrapped = withRateLimitRetry(fetchImpl, { sleepFn: async () => {} });
  const res = await wrapped('https://api.aem.live/x');
  assert.equal(res.status, 403);
  assert.equal(calls, 1);
});

test('withRequestPacer spaces request starts', async () => {
  let clock = 0;
  const starts = [];
  const fetchImpl = async () => {
    starts.push(clock);
    return new Response('ok', { status: 200 });
  };
  const wrapped = withRequestPacer(fetchImpl, {
    minIntervalMs: 100,
    now: () => clock,
    sleepFn: async (ms) => {
      clock += ms;
    },
  });

  await Promise.all([
    wrapped('https://api.aem.live/a'),
    wrapped('https://api.aem.live/b'),
    wrapped('https://api.aem.live/c'),
  ]);

  assert.deepEqual(starts, [0, 100, 200]);
});
