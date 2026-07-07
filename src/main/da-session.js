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

import { clearStoredToken, isTokenExpired, loadStoredToken } from './da-auth.js';
import { DA_UNAUTHORIZED_MESSAGE } from './content-api-shared.js';
import { PREVIEW_WEBVIEW_PARTITION } from './content-da-live-auth.js';
import { saveSiteTokens } from './site-token-store.js';

/** Origins that may retain IMS or DA credentials in Electron storage. */
export const DA_AUTH_STORAGE_ORIGINS = [
  'https://ims-na1.adobelogin.com',
  'https://admin.da.live',
  'https://content.da.live',
  'https://api.aem.live',
];

/**
 * Decodes the payload of an IMS access token (a JWT) without verifying it —
 * for diagnostics only.
 *
 * @param {string} accessToken
 * @returns {Record<string, unknown>|null}
 */
export function decodeImsTokenClaims(accessToken) {
  try {
    const payload = accessToken.split('.')[1];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/**
 * One-line description of a stored token for error messages and logs:
 * which client/user it was minted for and when it was issued/expires.
 * Never includes the token value itself.
 *
 * @param {{ access_token?: string, expires_at?: number|null }|null} stored
 * @returns {string}
 */
export function describeTokenDiagnostics(stored) {
  if (!stored?.access_token) {
    return 'no stored token';
  }
  const parts = [];
  const claims = decodeImsTokenClaims(stored.access_token);
  if (claims) {
    if (claims.client_id) {
      parts.push(`client_id=${claims.client_id}`);
    }
    if (claims.user_id) {
      parts.push(`user=${claims.user_id}`);
    }
    const createdAt = Number(claims.created_at);
    if (createdAt) {
      parts.push(`issued ${new Date(createdAt).toISOString()}`);
      const expiresIn = Number(claims.expires_in);
      if (expiresIn) {
        parts.push(`token expires ${new Date(createdAt + expiresIn).toISOString()}`);
      }
    }
  }
  if (stored.expires_at) {
    parts.push(`stored expiry ${new Date(stored.expires_at).toISOString()}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'token present but not a decodable JWT';
}

/** @type {import('electron').ClearStorageDataOptions['storages']} */
export const DA_AUTH_STORAGE_TYPES = [
  'cookies',
  'localstorage',
  'cachestorage',
  'serviceworkers',
  'indexdb',
];

/**
 * @param {string} tokenPath
 * @returns {Promise<string>}
 */
export async function resolveStoredAccessToken(tokenPath) {
  const stored = await loadStoredToken(tokenPath);
  if (!stored?.access_token) {
    throw new Error(
      `${DA_UNAUTHORIZED_MESSAGE} — No DA token file at ${tokenPath}. Sign in to AEM.`,
    );
  }
  if (isTokenExpired(stored)) {
    const expiry = stored.expires_at
      ? new Date(stored.expires_at).toISOString()
      : 'expiry not recorded';
    throw new Error(
      `${DA_UNAUTHORIZED_MESSAGE} — Stored token expired (${expiry}). Sign in again.`,
    );
  }
  return stored.access_token;
}

/**
 * Clears cookies and web storage for IMS / DA origins on the default session
 * and the given partitions. Without this, a persistent IMS session cookie
 * (e.g. in the preview-login partition) silently re-mints tokens for the
 * previously signed-in user after a sign-out.
 *
 * @param {typeof import('electron').session} electronSession
 * @param {string[]} [partitions]
 */
export async function clearDaAuthStorage(
  electronSession,
  partitions = [PREVIEW_WEBVIEW_PARTITION],
) {
  const options = {
    storages: DA_AUTH_STORAGE_TYPES,
    origins: DA_AUTH_STORAGE_ORIGINS,
  };
  await electronSession.defaultSession.clearStorageData(options);
  await Promise.all(partitions.map(
    (partition) => electronSession.fromPartition(partition).clearStorageData(options),
  ));
}

/**
 * Removes persisted and in-memory DA credentials: the IMS token file, the
 * per-site preview tokens, in-memory token caches, and IMS/DA cookies + web
 * storage in Electron sessions.
 *
 * @param {{
 *   tokenPath: string,
 *   siteTokensPath?: string,
 *   electronSession?: typeof import('electron').session,
 *   partitions?: string[],
 *   clearContentAuthCache?: () => void,
 *   clearPreviewCaches?: () => void,
 *   resetSiteTokensCache?: () => void,
 * }} options
 */
export async function invalidateDaSession({
  tokenPath,
  siteTokensPath,
  electronSession,
  partitions,
  clearContentAuthCache,
  clearPreviewCaches,
  resetSiteTokensCache,
}) {
  await clearStoredToken(tokenPath);
  clearContentAuthCache?.();
  resetSiteTokensCache?.();
  if (siteTokensPath) {
    await saveSiteTokens(siteTokensPath, {});
  }
  clearPreviewCaches?.();
  if (electronSession) {
    await clearDaAuthStorage(electronSession, partitions);
  }
}
