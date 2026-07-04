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

import { isTokenExpired, loadStoredToken } from './da-auth.js';

/** Hostname for protected DA media served outside admin.da.live/source. */
export const CONTENT_DA_LIVE_HOST = 'content.da.live';

/** webRequest filter for injecting IMS auth on content.da.live subresources. */
export const CONTENT_DA_LIVE_URL_FILTER = [`*://${CONTENT_DA_LIVE_HOST}/*`];

/** Shared partition so preview webviews reuse one session with auth wiring. */
export const PREVIEW_WEBVIEW_PARTITION = 'persist:aem-preview';

const TOKEN_CACHE_MS = 30_000;

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isContentDaLiveUrl(url) {
  try {
    return new URL(url).hostname === CONTENT_DA_LIVE_HOST;
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, string>} headers
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function withDaBearerAuth(headers, token) {
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Reads a stored IMS token without triggering browser login.
 *
 * @param {string} tokenPath
 * @returns {Promise<string|null>}
 */
export async function loadStoredDaBearerToken(tokenPath) {
  const stored = await loadStoredToken(tokenPath);
  if (stored?.access_token && !isTokenExpired(stored)) {
    return stored.access_token;
  }
  return null;
}

/**
 * @param {string} tokenPath
 * @returns {{ getToken: () => Promise<string|null>, clearCache: () => void }}
 */
export function createDaBearerTokenResolver(tokenPath) {
  /** @type {string|null} */
  let cachedToken = null;
  let cachedAt = 0;

  return {
    async getToken() {
      if (cachedToken && Date.now() - cachedAt < TOKEN_CACHE_MS) {
        return cachedToken;
      }
      cachedToken = await loadStoredDaBearerToken(tokenPath);
      cachedAt = Date.now();
      return cachedToken;
    },
    clearCache() {
      cachedToken = null;
      cachedAt = 0;
    },
  };
}

/**
 * Adds `Authorization: Bearer <IMS>` to requests for protected content.da.live
 * assets (images in preview webviews and the document view).
 *
 * @param {import('electron').Session} ses
 * @param {() => Promise<string|null>} getBearerToken
 */
export function registerContentDaLiveAuth(ses, getBearerToken) {
  ses.webRequest.onBeforeSendHeaders(
    { urls: CONTENT_DA_LIVE_URL_FILTER },
    (details, callback) => {
      getBearerToken()
        .then((token) => {
          if (!token) {
            callback({ requestHeaders: details.requestHeaders });
            return;
          }
          callback({
            requestHeaders: withDaBearerAuth(details.requestHeaders, token),
          });
        })
        .catch(() => {
          callback({ requestHeaders: details.requestHeaders });
        });
    },
  );
}

/**
 * @param {string} tokenPath
 * @param {typeof import('electron').session} electronSession
 * @returns {{ clearCache: () => void }}
 */
export function initContentDaLiveAuth(tokenPath, electronSession) {
  const resolver = createDaBearerTokenResolver(tokenPath);
  registerContentDaLiveAuth(electronSession.defaultSession, resolver.getToken);
  registerContentDaLiveAuth(
    electronSession.fromPartition(PREVIEW_WEBVIEW_PARTITION),
    resolver.getToken,
  );
  return { clearCache: resolver.clearCache };
}
