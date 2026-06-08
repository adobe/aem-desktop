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

/**
 * Normalizes a request pathname to a preview path (leading slash, `/` for root).
 *
 * @param {string} pathname
 * @returns {string}
 */
export function pathnameToPreviewPath(pathname) {
  if (!pathname || pathname === '/') {
    return '/';
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

/** Document extensions that map to clean URL paths on .aem.page. */
const DOCUMENT_EXTENSIONS = ['html'];

/**
 * @param {string} normalized - path with leading slash
 * @param {string} ext
 * @returns {string|null}
 */
function mapDocumentPath(normalized, ext) {
  const indexName = `/index.${ext}`;
  if (normalized === indexName) {
    return '/';
  }
  if (normalized.endsWith(indexName)) {
    const dir = normalized.slice(0, -indexName.length);
    return dir ? `${dir}/` : '/';
  }
  const suffix = `.${ext}`;
  if (normalized.endsWith(suffix)) {
    const withoutExt = normalized.slice(0, -suffix.length);
    return withoutExt || '/';
  }
  return null;
}

/**
 * Maps a repo-relative DA path to the URL path served on .aem.page.
 *
 * Examples:
 *   /this.html       → /this
 *   /this.json       → /this
 *   /that/index.html → /that/
 *   /styles.css      → /styles.css
 *
 * @param {string} daPath
 * @returns {string}
 */
export function daPathToPreviewPath(daPath) {
  const normalized = daPath.startsWith('/') ? daPath : `/${daPath}`;
  const lower = normalized.toLowerCase();

  for (const ext of DOCUMENT_EXTENSIONS) {
    if (lower.endsWith(`.${ext}`) || lower === `/index.${ext}` || lower.includes(`/index.${ext}`)) {
      const mapped = mapDocumentPath(normalized, ext);
      if (mapped !== null) {
        return mapped;
      }
    }
  }

  return normalized;
}

/**
 * @param {string} previewUrlOrigin - e.g. https://main--id--org.aem.page
 * @param {string} daPath
 * @returns {string}
 */
export function buildPreviewUrl(previewUrlOrigin, daPath) {
  const base = previewUrlOrigin.replace(/\/+$/, '');
  const previewPath = daPathToPreviewPath(daPath);
  if (previewPath === '/') {
    return `${base}/`;
  }
  return `${base}${previewPath}`;
}

/**
 * @param {string} previewUrlOrigin
 * @param {string} url
 * @returns {boolean}
 */
export function isSamePreviewOrigin(previewUrlOrigin, url) {
  try {
    const base = new URL(previewUrlOrigin);
    const target = new URL(url);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

/**
 * Maps a clean preview path to repo-relative paths under the sync folder.
 *
 * @param {string} previewPath
 * @returns {string[]}
 */
export function previewPathToLocalRelativePaths(previewPath) {
  const normalized = previewPath.startsWith('/') ? previewPath : `/${previewPath}`;
  if (normalized === '/') {
    return ['index.html'];
  }
  if (normalized.endsWith('/')) {
    return [`${normalized.slice(1)}index.html`];
  }
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) {
    return [normalized.slice(1)];
  }
  return [`${normalized.slice(1)}.html`];
}

/**
 * @param {string} proxyBase - e.g. http://127.0.0.1:4567
 * @param {string} daPath
 * @returns {{ url: string, previewPath: string, previewOrigin: string }}
 */
export function buildProxyPreviewUrl(proxyBase, daPath) {
  const base = proxyBase.replace(/\/+$/, '');
  const previewPath = daPathToPreviewPath(daPath);
  if (previewPath === '/') {
    return {
      url: `${base}/`,
      previewPath,
      previewOrigin: base,
    };
  }
  return {
    url: `${base}${previewPath}`,
    previewPath,
    previewOrigin: base,
  };
}

/**
 * @param {string} proxyOrigin
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedProxyPreviewNavigation(proxyOrigin, url) {
  try {
    const { origin } = new URL(proxyOrigin);
    const target = new URL(url);
    return target.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Builds the upstream .aem.page URL for a preview path.
 *
 * @param {string} previewUrlOrigin
 * @param {string} previewPath
 * @param {string} [search='']
 * @returns {string}
 */
export function buildUpstreamPreviewUrl(previewUrlOrigin, previewPath, search = '') {
  const base = previewUrlOrigin.replace(/\/+$/, '');
  if (previewPath === '/') {
    return `${base}/${search}`;
  }
  return `${base}${previewPath}${search}`;
}
