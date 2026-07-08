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
import { syncRoot } from './da-sync.js';
import {
  buildUpstreamPreviewUrl,
  pathnameToPreviewPath,
} from './preview-url.js';
import {
  readLocalPreviewContent,
  resolveLocalContentFile,
} from './preview-local.js';
import { createHeadHtmlCache } from './head-html.js';
import { createMetadataJsonCache } from './metadata-json.js';

const noop = () => {};

/**
 * @param {import('electron-log').MainLogger|undefined} log
 */
function previewLogger(log) {
  if (log?.scope) {
    return log.scope('preview');
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
  'if-modified-since',
  // The webview sends a localhost Origin on CORS requests (e.g. module scripts).
  // EDS rejects that foreign origin with a 403, so strip it — the proxy stands in
  // for the .aem.page origin and presents requests as same-origin.
  'origin',
  // Subresource requests carry the localhost proxy page as Referer. Chromium's
  // network stack (net.fetch) kills requests whose Referer doesn't match the
  // destination with net::ERR_BLOCKED_BY_CLIENT — and it leaks the local proxy
  // origin upstream — so never forward it.
  'referer',
]);

/**
 * Never forward a header the browser manages itself. Besides the fixed skip
 * list, sec-fetch-* describes the webview's fetch context, not the proxy's:
 * Chromium rejects a net.fetch carrying `sec-fetch-mode: cors` with
 * net::ERR_INVALID_ARGUMENT (module scripts break, stylesheets survive) and
 * sets its own sec-fetch-* on the upstream request anyway.
 *
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
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'x-frame-options',
]);

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string|string[]>} headers
 * @param {string} [body]
 */
function sendResponse(res, status, headers, body = '') {
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function sendText(res, status, message) {
  sendResponse(res, status, { 'content-type': 'text/plain; charset=utf-8' }, message);
}

/**
 * @param {string|null|undefined} siteToken
 * @returns {typeof fetch}
 */
function createAuthenticatedFetch(siteToken, fetchFn = fetch) {
  if (!siteToken) {
    return fetchFn;
  }
  return (url, init = {}) => {
    const headers = {
      ...(init.headers || {}),
      authorization: `token ${siteToken}`,
    };
    return fetchFn(url, { ...init, headers });
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} upstreamUrl
 * @param {string} proxyHost
 * @param {string|null|undefined} siteToken
 * @param {typeof fetch} fetchFn
 */
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} upstreamUrl
 * @param {string} proxyHost
 * @param {string|null|undefined} siteToken
 * @param {typeof fetch} fetchFn
 * @param {ReturnType<typeof previewLogger>} scope
 * @returns {Promise<Response>} the upstream response (headers already sent)
 */
async function proxyUpstream(req, res, upstreamUrl, proxyHost, siteToken, fetchFn, scope) {
  /** @type {Record<string, string>} */
  const reqHeaders = {
    'x-forwarded-host': proxyHost,
    'x-forwarded-scheme': 'http',
  };
  const names = Object.keys(req.headers);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!shouldSkipRequestHeader(name.toLowerCase())) {
      reqHeaders[name] = /** @type {string} */ (req.headers[name]);
    }
  }

  if (siteToken) {
    reqHeaders.authorization = `token ${siteToken}`;
  }

  const upstream = await fetchFn(upstreamUrl, {
    method: req.method,
    headers: reqHeaders,
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
    return upstream;
  }

  const bodyStream = Readable.fromWeb(upstream.body);
  bodyStream.on('error', (err) => {
    scope.error(`upstream body stream failed for ${upstreamUrl}: ${err.message}`);
    res.destroy(err);
  });
  bodyStream.pipe(res);
  return upstream;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isMainFrameDocumentRequest(req) {
  const dest = req.headers['sec-fetch-dest'];
  return dest !== 'image' && dest !== 'style' && dest !== 'script';
}

/**
 * @param {number} status
 * @param {string|null|undefined} siteToken
 * @returns {boolean}
 */
function upstreamStatusNeedsAuth(status, siteToken) {
  if (status === 401) {
    return true;
  }
  // Without a site token, a document 403 on preview usually means access control
  // rather than a post-login permission denial.
  return status === 403 && !siteToken;
}

/**
 * @param {string} upstreamUrl
 * @param {string|null|undefined} siteToken
 * @param {typeof fetch} fetchFn
 * @param {ReturnType<typeof previewLogger>} scope
 * @returns {Promise<boolean>}
 */
async function upstreamRequiresAuth(upstreamUrl, siteToken, fetchFn, scope) {
  if (siteToken) {
    return false;
  }
  try {
    const resp = await fetchFn(upstreamUrl, { method: 'HEAD', redirect: 'follow' });
    return upstreamStatusNeedsAuth(resp.status, siteToken);
  } catch (err) {
    scope.warn(`auth probe HEAD ${upstreamUrl} failed: ${err.message}`);
    return false;
  }
}

/**
 * @param {{
 *   org: string,
 *   repo: string,
 *   branch?: string,
 *   previewUrl: string,
 *   apiBackend?: string,
 * }} site
 * @param {import('node:http').IncomingMessage} req
 * @param {number} statusCode
 * @param {string|null|undefined} siteToken
 * @param {((site: object) => void)|undefined} onAuthRequired
 */
function maybeNotifyAuthRequired(site, req, statusCode, siteToken, onAuthRequired) {
  if (!onAuthRequired || !isMainFrameDocumentRequest(req)) {
    return;
  }
  if (upstreamStatusNeedsAuth(statusCode, siteToken)) {
    onAuthRequired(site);
  }
}

/**
 * @param {{
 *   getActiveSite: () => Promise<{
 *     org: string,
 *     repo: string,
 *     branch?: string,
 *     previewUrl: string,
 *     apiBackend?: string,
 *   }|null>,
 *   getSyncFolder: () => Promise<string|null>,
 *   getToken?: (site: {
 *     org: string,
 *     repo: string,
 *     branch?: string,
 *     previewUrl: string,
 *     apiBackend?: string,
 *   }) => Promise<string|null>,
 *   onAuthRequired?: (site: {
 *     org: string,
 *     repo: string,
 *     branch?: string,
 *     previewUrl: string,
 *     apiBackend?: string,
 *   }) => void,
 *   fetchFn?: typeof fetch,
 *   log?: import('electron-log').MainLogger,
 *   headHtmlCache?: ReturnType<typeof createHeadHtmlCache>,
 *   metadataJsonCache?: ReturnType<typeof createMetadataJsonCache>,
 * }} deps
 * @returns {Promise<{
 *   baseUrl: string,
 *   close: () => Promise<void>,
 *   headHtmlCache: ReturnType<typeof createHeadHtmlCache>,
 *   metadataJsonCache: ReturnType<typeof createMetadataJsonCache>,
 * }>}
 */
export async function startPreviewServer(deps) {
  const scope = previewLogger(deps.log);
  const headHtmlCache = deps.headHtmlCache || createHeadHtmlCache();
  const metadataJsonCache = deps.metadataJsonCache || createMetadataJsonCache();
  const fetchFn = deps.fetchFn || fetch;

  const server = createServer(async (req, res) => {
    const startedAt = Date.now();
    const elapsed = () => `${Date.now() - startedAt}ms`;

    if (!req.url) {
      scope.warn('400 — request without URL');
      sendText(res, 400, 'Bad request');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      scope.warn(`405 — ${req.method} ${req.url}`);
      sendText(res, 405, 'Method not allowed');
      return;
    }

    // One line per request start so hung requests are visible in the log.
    scope.info(`→ ${req.method} ${req.url} [dest: ${req.headers['sec-fetch-dest'] || '?'}]`);

    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const previewPath = pathnameToPreviewPath(requestUrl.pathname);

    const site = await deps.getActiveSite();
    if (!site) {
      scope.warn(`503 — no active site for ${req.method} ${req.url} (site switched or not activated?)`);
      sendText(res, 503, 'No active site for preview');
      return;
    }
    const pathWithQuery = `${previewPath}${requestUrl.search}`;
    const absolutePageUrl = `${requestUrl.origin}${requestUrl.pathname}${requestUrl.search}`;
    const upstreamUrl = buildUpstreamPreviewUrl(
      site.previewUrl,
      previewPath,
      requestUrl.search,
    );

    const token = deps.getToken ? await deps.getToken(site) : null;
    const tokenNote = token ? 'site token' : 'no site token';
    const authFetch = createAuthenticatedFetch(token, fetchFn);

    const syncFolder = await deps.getSyncFolder();
    if (syncFolder) {
      const localRoot = syncRoot(syncFolder, site.org, site.repo);
      const localFile = await resolveLocalContentFile(localRoot, previewPath);
      const authBlocked = localFile
        && isMainFrameDocumentRequest(req)
        && await upstreamRequiresAuth(upstreamUrl, token, fetchFn, scope);
      if (localFile && !authBlocked) {
        try {
          const headHtml = await headHtmlCache.resolve({
            previewUrlOrigin: site.previewUrl,
            syncRootDir: localRoot,
            fetchFn: authFetch,
          });
          const sheetRow = await metadataJsonCache.resolveSheetRow({
            previewUrlOrigin: site.previewUrl,
            syncRootDir: localRoot,
            previewPath,
            fetchFn: authFetch,
          });
          const { body, contentType } = await readLocalPreviewContent(
            localFile.filePath,
            localFile.relativePath,
            absolutePageUrl,
            headHtml,
            { sheetRow, previewUrlOrigin: site.previewUrl },
          );
          sendResponse(res, 200, {
            'content-type': contentType,
            'access-control-allow-origin': '*',
          }, req.method === 'HEAD' ? '' : body);
          scope.info(`local ${localFile.relativePath} -> 200 ${pathWithQuery} (${contentType}, ${elapsed()})`);
          return;
        } catch (err) {
          scope.warn(`failed to render local file ${localFile.filePath}: ${err.message} — falling back to upstream`);
        }
      } else if (authBlocked) {
        scope.info(`local ${localFile.relativePath} blocked — upstream requires auth`);
      }
    } else {
      scope.debug(`no sync folder configured — proxying ${pathWithQuery} upstream`);
    }

    const proxyHost = req.headers.host || requestUrl.host;
    try {
      const upstream = await proxyUpstream(req, res, upstreamUrl, proxyHost, token, fetchFn, scope);
      const contentType = upstream.headers.get('content-type') || 'no content-type';
      const logLine = `proxy ${pathWithQuery} -> ${upstreamUrl} `
        + `(${upstream.status}, ${contentType}, ${tokenNote}, ${elapsed()})`;
      if (upstream.status >= 400) {
        scope.warn(logLine);
      } else {
        scope.info(logLine);
      }
      maybeNotifyAuthRequired(site, req, res.statusCode, token, deps.onAuthRequired);
    } catch (err) {
      scope.error(`proxy failed for ${upstreamUrl} (${tokenNote}, ${elapsed()}): ${err.message}`);
      if (!res.headersSent) {
        sendText(res, 502, `Failed to proxy AEM request: ${err.message}`);
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Preview server did not bind to a TCP port');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  scope.info(`Preview proxy listening on ${baseUrl}`);

  return {
    baseUrl,
    headHtmlCache,
    metadataJsonCache,
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
