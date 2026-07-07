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

const MAX_ERROR_BODY_LEN = 500;

/** Response header with server-side error detail (helix6 / da.live). */
export const X_ERROR_HEADER = 'x-error';

/**
 * @param {string} message
 * @param {{ status?: number, xError?: string|null, url?: string, method?: string }} [meta]
 */
export class HttpRequestError extends Error {
  constructor(message, {
    status, xError, url, method,
  } = {}) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status ?? null;
    this.xError = xError ?? null;
    this.url = url ?? null;
    this.method = method ?? null;
  }
}

/**
 * @param {{
 *   method: string,
 *   url: string,
 *   status: number,
 *   statusText?: string,
 *   context?: string,
 *   xError?: string|null,
 *   bodyDetail?: string,
 * }} parts
 * @returns {string}
 */
export function composeHttpErrorMessage({
  method,
  url,
  status,
  statusText = '',
  context = '',
  xError = null,
  bodyDetail = '',
}) {
  const prefix = context ? `${context}: ` : '';
  const statusPart = `${status}${statusText ? ` ${statusText}` : ''}`;
  const messageParts = [`${prefix}${method} ${url} → ${statusPart}`];
  if (xError) {
    messageParts.push(`x-error: ${xError}`);
  }
  if (bodyDetail) {
    messageParts.push(bodyDetail);
  }
  if (status === 403) {
    messageParts.push('Forbidden — verify your token has access to this org/repo.');
  }
  return messageParts.join(' — ');
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Flattens an error's `cause` chain into one line. Node's fetch (undici)
 * reports network failures as a bare "TypeError: fetch failed" with the
 * actual reason (DNS, TLS, proxy, timeout) hidden in nested causes.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function describeErrorChain(err) {
  const parts = [];
  let current = err;
  while (current && parts.length < MAX_CAUSE_DEPTH) {
    const message = current instanceof Error ? current.message : String(current);
    const { code } = /** @type {{ code?: string }} */ (current);
    const part = code && !message.includes(code) ? `${message} (${code})` : message;
    if (part && !parts.includes(part)) {
      parts.push(part);
    }
    current = /** @type {{ cause?: unknown }} */ (current).cause;
  }
  return parts.join(' ← ') || 'unknown error';
}

/**
 * Builds the error for a fetch that failed before any HTTP response arrived
 * (DNS, TLS, proxy, offline), naming the request and the underlying cause.
 *
 * @param {string} method
 * @param {string} url
 * @param {unknown} err
 * @returns {HttpRequestError}
 */
export function buildFetchFailureError(method, url, err) {
  const message = `Network request failed: ${method} ${url} — ${describeErrorChain(err)}. `
    + 'Check your network, VPN, or proxy connection.';
  return new HttpRequestError(message, { method, url });
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Response} res
 * @param {string} [context]
 * @returns {Promise<HttpRequestError>}
 */
export async function buildHttpError(method, url, res, context = '') {
  const xError = res.headers.get(X_ERROR_HEADER);
  let bodyDetail = '';
  try {
    const text = await res.text();
    if (text) {
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null) {
            bodyDetail = parsed.message || parsed.error || parsed.detail || JSON.stringify(parsed);
          } else {
            bodyDetail = trimmed;
          }
        } catch {
          bodyDetail = trimmed;
        }
      } else {
        bodyDetail = trimmed;
      }
      if (bodyDetail.length > MAX_ERROR_BODY_LEN) {
        bodyDetail = `${bodyDetail.slice(0, MAX_ERROR_BODY_LEN)}…`;
      }
    }
  } catch {
    // ignore body read failures
  }

  const message = composeHttpErrorMessage({
    method,
    url,
    status: res.status,
    statusText: res.statusText,
    context,
    xError,
    bodyDetail,
  });

  return new HttpRequestError(message, {
    status: res.status,
    xError,
    url,
    method,
  });
}
