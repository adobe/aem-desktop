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
import {
  buildAuthErrorHtml,
  buildSiteLoginAckUrl,
  buildSiteLoginUrl,
  createSiteLoginSession,
  LOGIN_ACK_ROUTE,
  LOGIN_ROUTE,
  siteAuthRequestHeaders,
} from './site-auth.js';

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
]);

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
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {string|null|undefined} siteToken
 * @returns {typeof fetch}
 */
function createAuthenticatedFetch(siteToken, fetchFn = fetch) {
  const authHeaders = siteAuthRequestHeaders(siteToken);
  return (url, init = {}) => {
    const headers = {
      ...(init.headers || {}),
      ...authHeaders,
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
 */
async function proxyUpstream(req, res, upstreamUrl, proxyHost, siteToken, fetchFn) {
  /** @type {Record<string, string>} */
  const reqHeaders = {
    'x-forwarded-host': proxyHost,
    'x-forwarded-scheme': 'http',
    ...siteAuthRequestHeaders(siteToken),
  };
  const names = Object.keys(req.headers);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!SKIP_REQUEST_HEADERS.has(name.toLowerCase())) {
      reqHeaders[name] = /** @type {string} */ (req.headers[name]);
    }
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

  if (upstream.status === 401 || upstream.status === 403) {
    const contentType = upstream.headers.get('content-type') || 'text/plain';
    if (contentType.startsWith('text/html')) {
      const textBody = await upstream.text();
      respHeaders['content-type'] = contentType;
      sendResponse(res, upstream.status, respHeaders, req.method === 'HEAD' ? '' : textBody);
      return;
    }

    respHeaders['content-type'] = 'text/html; charset=utf-8';
    sendResponse(
      res,
      upstream.status,
      respHeaders,
      req.method === 'HEAD' ? '' : buildAuthErrorHtml(upstream.status, upstreamUrl),
    );
    return;
  }

  res.writeHead(upstream.status, respHeaders);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
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
 *   getSiteToken?: () => Promise<string|null>,
 *   onSiteToken?: (siteToken: string) => Promise<void>|void,
 *   loginSession?: ReturnType<import('./site-auth.js').createSiteLoginSession>,
 *   fetchFn?: typeof fetch,
 *   log?: import('electron-log').MainLogger,
 * }} deps
 * @returns {Promise<{
 *   baseUrl: string,
 *   close: () => Promise<void>,
 *   headHtmlCache: ReturnType<typeof createHeadHtmlCache>,
 *   metadataJsonCache: ReturnType<typeof createMetadataJsonCache>,
 *   loginSession: ReturnType<import('./site-auth.js').createSiteLoginSession>,
 * }>}
 */
export async function startPreviewServer(deps) {
  const scope = previewLogger(deps.log);
  const headHtmlCache = deps.headHtmlCache || createHeadHtmlCache();
  const metadataJsonCache = deps.metadataJsonCache || createMetadataJsonCache();
  const loginSession = deps.loginSession || createSiteLoginSession();
  const getSiteToken = deps.getSiteToken || (async () => null);
  const fetchFn = deps.fetchFn || fetch;

  const server = createServer(async (req, res) => {
    if (!req.url) {
      sendText(res, 400, 'Bad request');
      return;
    }

    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const { pathname } = requestUrl;

    if (pathname === LOGIN_ROUTE && req.method === 'GET') {
      const site = await deps.getActiveSite();
      if (!site) {
        sendText(res, 503, 'No active site for preview');
        return;
      }

      const baseUrl = `http://${requestUrl.host}`;
      const loginUrl = buildSiteLoginUrl({
        org: site.org,
        repo: site.repo,
        branch: site.branch,
        apiBackend: site.apiBackend,
        ackUrl: buildSiteLoginAckUrl(baseUrl),
      });
      const redirectUrl = loginSession.buildLoginRedirectUrl(loginUrl);
      scope.info(`Redirecting to site login for ${site.org}/${site.repo}`);
      sendResponse(res, 302, { location: redirectUrl });
      return;
    }

    if (pathname === LOGIN_ACK_ROUTE) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const ack = await loginSession.handleAck({
        method: req.method || 'GET',
        origin: req.headers.origin,
        body,
      });

      if (ack.siteToken && deps.onSiteToken) {
        try {
          await deps.onSiteToken(ack.siteToken);
          scope.info('Site token received from Admin login');
        } catch (err) {
          scope.error(`Failed to persist site token: ${err.message}`);
          sendText(res, 500, 'Failed to save site token');
          return;
        }
      }

      sendResponse(res, ack.status, ack.headers, ack.body);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    const previewPath = pathnameToPreviewPath(pathname);

    const site = await deps.getActiveSite();
    if (!site) {
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

    const siteToken = await getSiteToken();
    const authFetch = createAuthenticatedFetch(siteToken, fetchFn);

    const syncFolder = await deps.getSyncFolder();
    if (syncFolder) {
      const localRoot = syncRoot(syncFolder, site.org, site.repo);
      const localFile = await resolveLocalContentFile(localRoot, previewPath);
      if (localFile) {
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
          scope.info(`local ${localFile.relativePath} -> 200 ${pathWithQuery}`);
          return;
        } catch (err) {
          scope.warn(`failed to read local file ${localFile.filePath}: ${err.message}`);
        }
      }
    }

    const proxyHost = req.headers.host || requestUrl.host;
    try {
      await proxyUpstream(req, res, upstreamUrl, proxyHost, siteToken, fetchFn);
      scope.info(`proxy ${pathWithQuery} -> ${upstreamUrl} (${res.statusCode})`);
    } catch (err) {
      scope.error(`proxy failed for ${upstreamUrl}: ${err.message}`);
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
    loginSession,
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
