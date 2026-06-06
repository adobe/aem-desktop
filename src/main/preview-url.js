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
