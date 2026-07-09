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
import https from 'node:https';
import { Readable } from 'node:stream';
import { RUM_UPSTREAM_ORIGIN } from '../rum-config.js';

/**
 * Fetch compatible with the RUM proxy, using Node's https stack. Electron's main
 * process `fetch` and `net.fetch` share Chromium networking rules that reject
 * many beacon POST shapes (ERR_INVALID_ARGUMENT / ERR_BLOCKED_BY_CLIENT).
 *
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function rumUpstreamFetch(url, init = {}) {
  const target = new URL(String(url));
  if (target.origin !== RUM_UPSTREAM_ORIGIN) {
    return Promise.reject(new Error(`RUM upstream fetch is limited to ${RUM_UPSTREAM_ORIGIN}`));
  }
  if (target.protocol !== 'https:') {
    return Promise.reject(new Error(`RUM upstream must use https: ${target.href}`));
  }

  const method = init.method || 'GET';
  /** @type {Record<string, string>} */
  const headers = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  const { body: requestBody } = init;
  let body = requestBody;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    if (body instanceof Buffer) {
      body = body.toString('utf8');
    } else {
      body = String(body);
    }
  }
  if (body !== undefined && body !== null) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
    }, (res) => {
      /** @type {Record<string, string>} */
      const responseHeaders = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === 'string') {
          responseHeaders[key] = value;
        } else if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        }
      }
      resolve(new Response(Readable.toWeb(res), {
        status: res.statusCode || 0,
        statusText: res.statusMessage || '',
        headers: responseHeaders,
      }));
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
