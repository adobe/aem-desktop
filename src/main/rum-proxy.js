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
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DESKTOP_RUM_ORIGIN, RUM_UPSTREAM_ORIGIN } from '../rum-config.js';

const noop = () => {};

/**
 * @param {import('electron-log').MainLogger|undefined} log
 */
function rumLogger(log) {
  if (log?.scope) {
    return log.scope('rum');
  }
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

const SKIP_REQUEST_HEADERS = new Set([
  'connection',
  'host',
  'proxy-connection',
  'origin',
  'referer',
]);

/**
 * @param {string} name lower-cased header name
 * @returns {boolean}
 */
function shouldSkipRequestHeader(name) {
  return SKIP_REQUEST_HEADERS.has(name) || name.startsWith('sec-fetch-');
}

const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'keep-alive',
  'transfer-encoding',
]);

/**
 * @param {string|undefined|null} referer
 * @returns {boolean}
 */
export function shouldRewriteRumReferer(referer) {
  if (typeof referer !== 'string' || referer.length === 0) {
    return true;
  }
  if (referer.startsWith(DESKTOP_RUM_ORIGIN)) {
    return false;
  }
  if (referer.startsWith('file:')) {
    return true;
  }
  if (referer.includes('127.0.0.1') || referer.includes('localhost')) {
    return true;
  }
  return referer.startsWith('null');
}

/**
 * Rewrites RUM beacon JSON so referer uses {@link DESKTOP_RUM_ORIGIN}. Cooperative
 * `top` pings carry the full virtual path; click pings from the enhancer inherit the
 * most recent desktop referer when their payload still reflects file://.
 *
 * @param {string} bodyText
 * @param {string} fallbackReferer
 * @returns {{ body: string, referer: string }}
 */
export function rewriteRumBeaconBody(bodyText, fallbackReferer) {
  const fallback = fallbackReferer || `${DESKTOP_RUM_ORIGIN}/`;
  try {
    const payload = JSON.parse(bodyText);
    if (!payload || typeof payload !== 'object') {
      return { body: bodyText, referer: fallback };
    }
    const current = typeof payload.referer === 'string' ? payload.referer : '';
    if (!shouldRewriteRumReferer(current)) {
      return { body: bodyText, referer: current };
    }
    payload.referer = fallback;
    return { body: JSON.stringify(payload), referer: fallback };
  } catch {
    return { body: bodyText, referer: fallback };
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Local forwarder for `/.rum/*` so the renderer can load helix-rum-js and send
 * beacons without widening CSP to rum.hlx.page directly.
 *
 * @param {{
 *   fetchFn?: typeof fetch,
 *   log?: import('electron-log').MainLogger,
 * }} [options]
 */
export async function startRumProxy({ fetchFn = fetch, log } = {}) {
  const scope = rumLogger(log);
  let lastDesktopReferer = `${DESKTOP_RUM_ORIGIN}/`;

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (!requestUrl.pathname.startsWith('/.rum/')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const upstreamUrl = `${RUM_UPSTREAM_ORIGIN}${requestUrl.pathname}${requestUrl.search}`;
    /** @type {Record<string, string>} */
    const reqHeaders = {};
    const names = Object.keys(req.headers);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (!shouldSkipRequestHeader(name.toLowerCase())) {
        reqHeaders[name] = /** @type {string} */ (req.headers[name]);
      }
    }

    let body;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const raw = await readRequestBody(req);
      if (raw.length > 0) {
        const rewritten = rewriteRumBeaconBody(raw.toString('utf8'), lastDesktopReferer);
        body = rewritten.body;
        lastDesktopReferer = rewritten.referer;
        // Site identity lives in the JSON payload. Do not forward an HTTP Referer
        // to rum.hlx.page — Chromium net.fetch rejects cross-origin referers with
        // ERR_BLOCKED_BY_CLIENT (same constraint as the preview proxy).
        reqHeaders['content-type'] = req.headers['content-type'] || 'application/json';
        reqHeaders['content-length'] = String(Buffer.byteLength(body));
      }
    }

    try {
      const upstream = await fetchFn(upstreamUrl, {
        method: req.method,
        headers: reqHeaders,
        body,
        redirect: 'follow',
      });

      /** @type {Record<string, string|string[]>} */
      const respHeaders = {
        'access-control-allow-origin': '*',
      };
      upstream.headers.forEach((value, key) => {
        if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          respHeaders[key] = value;
        }
      });

      res.writeHead(upstream.status, respHeaders);
      if (req.method === 'HEAD' || !upstream.body) {
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (err) {
      scope.warn(`upstream ${req.method} ${requestUrl.pathname} failed: ${err.message}`);
      res.writeHead(502);
      res.end('Bad gateway');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('RUM proxy did not bind to a TCP port');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  scope.info(`RUM proxy listening on ${baseUrl}`);

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    }),
  };
}
