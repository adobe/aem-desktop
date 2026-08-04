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

/**
 * Compact `host + path + query` for a request URL (drops the protocol so lines
 * stay short). Falls back to the raw string for non-URL inputs.
 *
 * @param {string|URL} url
 * @returns {string}
 */
export function describeRequestUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return String(url);
  }
}

/**
 * One-line summary of a completed (or failed) request.
 *
 * @param {{
 *   seq: number,
 *   method: string,
 *   url: string|URL,
 *   status?: number,
 *   ms: number,
 *   error?: string,
 * }} info
 * @returns {string}
 */
export function formatRequestLogLine({
  seq, method, url, status, ms, error,
}) {
  const target = describeRequestUrl(url);
  const outcome = error ? `ERR ${error}` : String(status);
  return `#${seq} ${method} ${target} → ${outcome} (${ms}ms)`;
}

/**
 * Wraps a fetch implementation to log every request (method, URL, status,
 * duration) with a process-wide sequence number. 429s and errors log at
 * warn/error so they stand out; everything else logs at info. Returns the
 * original fetch untouched when disabled, so packaged builds pay nothing.
 *
 * @param {typeof fetch} fetchImpl
 * @param {{
 *   logger: { info: Function, warn: Function, error: Function },
 *   enabled?: boolean,
 *   clock?: () => number,
 * }} options
 * @returns {typeof fetch}
 */
export function withRequestLogging(fetchImpl, { logger, enabled = true, clock = Date.now } = {}) {
  if (!enabled) {
    return fetchImpl;
  }
  let seq = 0;
  return async (url, init = {}) => {
    seq += 1;
    const requestSeq = seq;
    const method = init.method || 'GET';
    const started = clock();
    try {
      const res = await fetchImpl(url, init);
      const ms = clock() - started;
      const line = formatRequestLogLine({
        seq: requestSeq, method, url, status: res.status, ms,
      });
      if (res.status === 429) {
        logger.warn(line);
      } else {
        logger.info(line);
      }
      return res;
    } catch (err) {
      const ms = clock() - started;
      logger.error(formatRequestLogLine({
        seq: requestSeq, method, url, ms, error: err?.message || String(err),
      }));
      throw err;
    }
  };
}
