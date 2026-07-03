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

// Pure (electron-free) helpers for the preview login flow, so they unit test
// under `node --test`. The window-opening side lives in preview-login.js.

import { API_BACKEND_AEM_API } from './content-api-shared.js';

export const ADMIN_BASE = 'https://admin.hlx.page';
export const ADMIN_AEM_API_BASE = 'https://api.aem.live';

// Host suffixes the login window is allowed to navigate to. The window runs with
// contextIsolation disabled (so its preload can capture the site token), so it
// must never load arbitrary web content — only the admin service and the known
// identity providers in the AEM admin login chain. Navigations and postMessage
// senders outside this set are rejected.
export const ALLOWED_LOGIN_HOST_SUFFIXES = Object.freeze([
  'hlx.page',
  'aem.live',
  'aem.page',
  'adobelogin.com',
  'adobe.com',
  'adobe.io',
  'adobe.net',
  // Adobe-owned domain IMS bounces through for cross-domain session continuity
  // (e.g. sso.behance.net/ims/cdsc_redirect) partway through the login.
  'behance.net',
  // Non-Adobe IdPs that AEM site auth can be configured against.
  'microsoftonline.com',
  'live.com',
  'google.com',
  'googleusercontent.com',
  'okta.com',
]);

/**
 * @param {string} url
 * @returns {boolean} whether the login window may navigate to / accept messages from this URL
 */
export function isAllowedLoginNavigation(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') {
      return false;
    }
    return ALLOWED_LOGIN_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/**
 * Derives the branch ref from a preview URL host (`<ref>--<repo>--<org>.aem.page`).
 *
 * @param {string} previewUrl
 * @returns {string} the ref, defaulting to 'main'
 */
export function parsePreviewRef(previewUrl) {
  try {
    const { hostname } = new URL(previewUrl);
    const [sub] = hostname.split('.');
    const parts = sub.split('--');
    return parts.length >= 3 && parts[0] ? parts[0] : 'main';
  } catch {
    return 'main';
  }
}

/**
 * @param {string|undefined} apiBackend
 * @returns {string}
 */
export function adminBaseForApiBackend(apiBackend) {
  return apiBackend === API_BACKEND_AEM_API ? ADMIN_AEM_API_BASE : ADMIN_BASE;
}

/**
 * Builds the admin login URL. `extensionId` makes the admin page deliver tokens
 * over chrome.runtime messaging (intercepted by the login window preload).
 *
 * @param {{
 *   org: string,
 *   site: string,
 *   ref: string,
 *   adminBase?: string,
 *   extensionId?: string,
 * }} opts
 * @returns {string}
 */
export function buildAdminLoginUrl({
  org, site, ref, adminBase = ADMIN_BASE, extensionId,
}) {
  if (adminBase === ADMIN_AEM_API_BASE) {
    const url = new URL(`${ADMIN_AEM_API_BASE}/login`);
    url.searchParams.set('org', org);
    url.searchParams.set('site', site);
    if (extensionId) {
      url.searchParams.set('extensionId', extensionId);
    }
    return url.toString();
  }

  const url = new URL(`${adminBase}/login/${org}/${site}/${ref}`);
  if (extensionId) {
    url.searchParams.set('extensionId', extensionId);
  }
  return url.toString();
}

/**
 * Normalizes a captured login message into a stored site-token entry, or null
 * when it carries no site token. `siteTokenExpiry` is seconds-since-epoch
 * (mirrors the sidekick); we store it as epoch milliseconds.
 *
 * @param {any} message
 * @returns {{ token: string, expiresAt: number|null }|null}
 */
export function siteTokenEntryFromMessage(message) {
  const token = message?.siteToken || message?.token;
  if (!token || typeof token !== 'string') {
    return null;
  }
  const expirySeconds = Number(message?.siteTokenExpiry);
  const expiresAt = Number.isFinite(expirySeconds) && expirySeconds > 0
    ? expirySeconds * 1000
    : null;
  return { token, expiresAt };
}
