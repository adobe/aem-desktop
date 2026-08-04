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

/** Admin API limit is 10 req/s per project; stay under to reduce 429s. */
export const AEM_ADMIN_TARGET_RPS = 8;

/** Minimum gap between request starts when pacing toward {@link AEM_ADMIN_TARGET_RPS}. */
export const AEM_ADMIN_MIN_INTERVAL_MS = Math.ceil(1000 / AEM_ADMIN_TARGET_RPS);

export const RATE_LIMIT_MAX_RETRIES = 5;
export const RATE_LIMIT_DEFAULT_DELAY_MS = 1000;
export const RATE_LIMIT_MAX_DELAY_MS = 30000;

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Parses a Retry-After header (delta-seconds or HTTP-date) into a delay in ms.
 *
 * @param {string|null|undefined} retryAfter
 * @param {number} [now]
 * @returns {number|null} delay in ms, or null if missing/invalid
 */
export function parseRetryAfterMs(retryAfter, now = Date.now()) {
  if (retryAfter == null || retryAfter === '') {
    return null;
  }
  const trimmed = String(retryAfter).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.min(Math.ceil(seconds * 1000), RATE_LIMIT_MAX_DELAY_MS);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return Math.min(Math.max(0, dateMs - now), RATE_LIMIT_MAX_DELAY_MS);
}

/**
 * Delay before the next attempt after a 429. Prefers Retry-After; otherwise
 * exponential backoff with a small jitter.
 *
 * @param {number} attempt zero-based retry attempt index
 * @param {{
 *   retryAfterMs?: number|null,
 *   baseMs?: number,
 *   maxMs?: number,
 *   random?: () => number,
 * }} [options]
 * @returns {number}
 */
export function computeBackoffDelayMs(attempt, {
  retryAfterMs = null,
  baseMs = RATE_LIMIT_DEFAULT_DELAY_MS,
  maxMs = RATE_LIMIT_MAX_DELAY_MS,
  random = Math.random,
} = {}) {
  if (retryAfterMs != null) {
    return Math.min(Math.max(0, retryAfterMs), maxMs);
  }
  const exp = Math.min(baseMs * (2 ** Math.max(0, attempt)), maxMs);
  const jitter = Math.floor(random() * Math.min(baseMs, Math.max(1, Math.floor(exp * 0.25))));
  return Math.min(exp + jitter, maxMs);
}

/**
 * Drains a response body so the connection can be reused after a retry.
 *
 * @param {Response} res
 * @returns {Promise<void>}
 */
async function drainResponse(res) {
  try {
    await res.arrayBuffer();
  } catch {
    // ignore drain failures
  }
}

/**
 * Wraps fetch to retry on HTTP 429, honoring Retry-After when present.
 *
 * @param {typeof fetch} fetchImpl
 * @param {{
 *   maxRetries?: number,
 *   sleepFn?: typeof sleep,
 *   onRetry?: (info: {
 *     attempt: number,
 *     delayMs: number,
 *     url: string,
 *     method: string,
 *     retryAfter: string|null,
 *   }) => void,
 * }} [options]
 * @returns {typeof fetch}
 */
export function withRateLimitRetry(fetchImpl, {
  maxRetries = RATE_LIMIT_MAX_RETRIES,
  sleepFn = sleep,
  onRetry,
} = {}) {
  return async (url, init = {}) => {
    let attempt = 0;
    for (;;) {
      const res = await fetchImpl(url, init); // eslint-disable-line no-await-in-loop
      if (res.status !== 429 || attempt >= maxRetries) {
        return res;
      }
      const retryAfter = res.headers.get('retry-after');
      const delayMs = computeBackoffDelayMs(attempt, {
        retryAfterMs: parseRetryAfterMs(retryAfter),
      });
      onRetry?.({
        attempt: attempt + 1,
        delayMs,
        url: String(url),
        method: init.method || 'GET',
        retryAfter,
      });
      await drainResponse(res); // eslint-disable-line no-await-in-loop
      await sleepFn(delayMs, init.signal); // eslint-disable-line no-await-in-loop
      attempt += 1;
    }
  };
}

/**
 * Creates a shareable pacing gate. Calling the returned function reserves the
 * next slot (spaced by `minIntervalMs`) and resolves when it is time to
 * proceed. Sharing one gate across many fetch wrappers / client instances caps
 * the *combined* request rate — unlike {@link withRequestPacer}, whose gate is
 * private to a single wrapper and so resets every time a new client is built.
 *
 * @param {{
 *   minIntervalMs?: number,
 *   sleepFn?: typeof sleep,
 *   now?: () => number,
 * }} [options]
 * @returns {(signal?: AbortSignal) => Promise<void>}
 */
export function createRequestPacer({
  minIntervalMs = AEM_ADMIN_MIN_INTERVAL_MS,
  sleepFn = sleep,
  now = Date.now,
} = {}) {
  let nextAllowedAt = 0;
  let gate = Promise.resolve();

  return (signal) => {
    const scheduled = gate.then(async () => {
      const waitMs = Math.max(0, nextAllowedAt - now());
      if (waitMs > 0) {
        await sleepFn(waitMs, signal);
      }
      nextAllowedAt = now() + minIntervalMs;
    });
    // Keep the gate moving even if a wait is aborted.
    gate = scheduled.catch(() => {});
    return scheduled;
  };
}

/**
 * Spaces out request *starts* so sustained throughput stays near a target RPS.
 * In-flight requests may still overlap; this only gates when the next fetch begins.
 *
 * @param {typeof fetch} fetchImpl
 * @param {{
 *   minIntervalMs?: number,
 *   sleepFn?: typeof sleep,
 *   now?: () => number,
 * }} [options]
 * @returns {typeof fetch}
 */
export function withRequestPacer(fetchImpl, options = {}) {
  const pace = createRequestPacer(options);
  return async (url, init = {}) => {
    await pace(init.signal);
    return fetchImpl(url, init);
  };
}
