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
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { API_BACKEND_AEM_API } from './content-api-shared.js';

export const SITE_TOKENS_FILENAME = '.site-tokens.json';
export const LOGIN_ROUTE = '/.aem/cli/login';
export const LOGIN_ACK_ROUTE = '/.aem/cli/login/ack';
export const SITE_AUTH_CLIENT_ID = 'aem-cli';

const ADMIN_ORIGIN = 'https://admin.hlx.page';
const ADMIN_ORIGIN_NEW = 'https://api.aem.live';
const ADMIN_CI_ORIGIN = 'https://admin-ci.hlx.page';

const TRUSTED_ACK_ORIGINS = new Set([
  ADMIN_ORIGIN,
  ADMIN_ORIGIN_NEW,
  ADMIN_CI_ORIGIN,
]);

/**
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function siteAuthKey(org, repo) {
  return `${org}/${repo}`;
}

/**
 * @param {unknown} siteToken
 * @returns {boolean}
 */
export function isValidSiteTokenFormat(siteToken) {
  return typeof siteToken === 'string'
    && siteToken.startsWith('hlxtst_')
    && siteToken.length > 'hlxtst_'.length;
}

/**
 * @param {string} storePath
 * @returns {Promise<Record<string, { siteToken: string, updatedAt: string }>>}
 */
export async function loadSiteTokenStore(storePath) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} storePath
 * @param {Record<string, { siteToken: string, updatedAt: string }>} store
 */
export async function saveSiteTokenStore(storePath, store) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} storePath
 * @param {string} org
 * @param {string} repo
 * @returns {Promise<string|null>}
 */
export async function getStoredSiteToken(storePath, org, repo) {
  const store = await loadSiteTokenStore(storePath);
  const entry = store[siteAuthKey(org, repo)];
  return entry?.siteToken || null;
}

/**
 * @param {string} storePath
 * @param {string} org
 * @param {string} repo
 * @param {string} siteToken
 */
export async function saveSiteToken(storePath, org, repo, siteToken) {
  if (!isValidSiteTokenFormat(siteToken)) {
    throw new Error('Invalid site token format');
  }
  const store = await loadSiteTokenStore(storePath);
  store[siteAuthKey(org, repo)] = {
    siteToken,
    updatedAt: new Date().toISOString(),
  };
  await saveSiteTokenStore(storePath, store);
}

/**
 * @param {string} storePath
 * @param {string} org
 * @param {string} repo
 * @returns {Promise<{ authenticated: boolean }>}
 */
export async function getSiteAuthStatus(storePath, org, repo) {
  const siteToken = await getStoredSiteToken(storePath, org, repo);
  return { authenticated: Boolean(siteToken) };
}

/**
 * @param {{
 *   org: string,
 *   repo: string,
 *   branch?: string,
 *   apiBackend?: string,
 *   ackUrl: string,
 *   selectAccount?: boolean,
 * }} options
 * @returns {string}
 */
export function buildSiteLoginUrl({
  org,
  repo,
  branch = 'main',
  apiBackend,
  ackUrl,
  selectAccount = true,
}) {
  const params = new URLSearchParams({
    client_id: SITE_AUTH_CLIENT_ID,
    redirect_uri: ackUrl,
  });
  if (selectAccount) {
    params.set('selectAccount', 'true');
  }

  if (apiBackend === API_BACKEND_AEM_API) {
    const loginUrl = new URL(`${ADMIN_ORIGIN_NEW}/login`);
    loginUrl.searchParams.set('org', org);
    loginUrl.searchParams.set('site', repo);
    params.forEach((value, key) => {
      loginUrl.searchParams.set(key, value);
    });
    return loginUrl.toString();
  }

  return `${ADMIN_ORIGIN}/login/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}?${params}`;
}

/**
 * @param {string} proxyBaseUrl
 * @returns {string}
 */
export function buildSiteLoginAckUrl(proxyBaseUrl) {
  const base = proxyBaseUrl.replace(/\/+$/, '');
  return `${base}${LOGIN_ACK_ROUTE}`;
}

/**
 * @param {number} status
 * @param {string} upstreamUrl
 * @returns {string}
 */
export function buildAuthErrorHtml(status, upstreamUrl) {
  const statusText = status === 401 ? '401 Unauthorized' : '403 Forbidden';
  const escapedUrl = upstreamUrl
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  return `<html><head><meta name="color-scheme" content="light dark"><meta property="hlx:proxyUrl" content="${escapedUrl}"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${statusText}</pre></body></html>`;
}

/**
 * @param {string|null|undefined} siteToken
 * @returns {Record<string, string>}
 */
export function siteAuthRequestHeaders(siteToken) {
  if (!siteToken) {
    return {};
  }
  return { authorization: `token ${siteToken}` };
}

/**
 * Creates per-preview-server login state for the Admin callback flow.
 *
 * @returns {{
 *   createState: () => string,
 *   buildLoginRedirectUrl: (loginUrl: string) => string,
 *   handleAck: (options: {
 *     method: string,
 *     origin?: string,
 *     body?: { state?: string, siteToken?: string },
 *   }) => Promise<{
 *     status: number,
 *     headers: Record<string, string>,
 *     body: string,
 *     siteToken?: string,
 *   }>,
 *   consumeLoginError: () => { message: string }|null,
 * }}
 */
export function createSiteLoginSession() {
  /** @type {string|null} */
  let loginState = null;
  /** @type {{ message: string }|null} */
  let loginError = null;

  return {
    createState() {
      loginState = randomUUID();
      return loginState;
    },

    buildLoginRedirectUrl(loginUrl) {
      if (!loginState) {
        loginState = randomUUID();
      }
      const url = new URL(loginUrl);
      url.searchParams.set('state', loginState);
      return url.toString();
    },

    async handleAck({ method, origin, body }) {
      const cacheControl = 'no-store, private, must-revalidate';
      /** @type {Record<string, string>} */
      const corsHeaders = {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      };
      if (origin && TRUSTED_ACK_ORIGINS.has(origin)) {
        corsHeaders['access-control-allow-origin'] = origin;
      }

      if (method === 'OPTIONS') {
        return {
          status: 200,
          headers: corsHeaders,
          body: '',
        };
      }

      if (method === 'POST') {
        try {
          if (!loginState || loginState !== body?.state) {
            loginError = { message: 'Login Failed: We received an invalid state.' };
            return {
              status: 400,
              headers: { ...corsHeaders, 'cache-control': cacheControl },
              body: 'Invalid state',
            };
          }

          const { siteToken } = body || {};
          if (!siteToken || !isValidSiteTokenFormat(siteToken)) {
            loginError = { message: 'Login Failed: Missing site token.' };
            return {
              status: 400,
              headers: { ...corsHeaders, 'cache-control': cacheControl },
              body: 'Missing site token',
            };
          }

          return {
            status: 200,
            headers: { ...corsHeaders, 'cache-control': cacheControl },
            body: 'Login successful.',
            siteToken,
          };
        } finally {
          loginState = null;
        }
      }

      if (loginError) {
        const err = loginError;
        loginError = null;
        return {
          status: 400,
          headers: { 'cache-control': cacheControl },
          body: err.message,
        };
      }

      return {
        status: 302,
        headers: {
          'cache-control': cacheControl,
          location: '/',
        },
        body: '',
      };
    },

    consumeLoginError() {
      const err = loginError;
      loginError = null;
      return err;
    },
  };
}
