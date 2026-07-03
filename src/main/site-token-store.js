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
import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SITE_TOKEN_FILENAME = '.site-tokens.json';

/**
 * EDS preview/publish tiers (.aem.page/.aem.live) authorize requests with a
 * site token presented as `Authorization: token <value>` — never a cookie and
 * never the DA/IMS token (see da-auth.js). These are minted by the admin login
 * flow and captured by the in-app preview login (preview-login.js). We persist
 * them per upstream origin so a preview session survives app restarts until the
 * token expires.
 */

/**
 * @param {{ token?: string, expiresAt?: number|null }|null|undefined} entry
 * @returns {boolean}
 */
export function isSiteTokenExpired(entry) {
  if (!entry?.token) {
    return true;
  }
  if (entry.expiresAt) {
    // 60s buffer mirrors da-auth.isTokenExpired so we refresh before the edge does.
    return Date.now() >= (entry.expiresAt - 60_000);
  }
  // No expiry recorded — treat as usable; the edge is the final arbiter (401 → re-login).
  return false;
}

/**
 * @param {string} storePath
 * @returns {Promise<Record<string, { token: string, expiresAt: number|null }>>}
 */
export async function loadSiteTokens(storePath) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} storePath
 * @param {Record<string, { token: string, expiresAt: number|null }>} tokens
 */
export async function saveSiteTokens(storePath, tokens) {
  // Site tokens are bearer-equivalent credentials, so keep the directory and
  // file owner-only (0700/0600) rather than the default world-readable mode.
  await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
  const handle = await open(storePath, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Normalizes a preview URL to the origin key the proxy authorizes against.
 *
 * @param {string} previewUrl - e.g. https://main--site--org.aem.page/some/path
 * @returns {string} the origin, e.g. https://main--site--org.aem.page
 */
export function siteTokenKey(previewUrl) {
  return new URL(previewUrl).origin;
}
