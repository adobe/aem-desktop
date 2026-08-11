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
 * Rewrites `./media_<hash>.<ext>` references in downloaded HTML to absolute URLs
 * pointing at the site origin, resolved relative to the HTML file's own path
 * (so images render when the local working copy is opened directly). The
 * transform is applied only to the editable working copy; the `.aem` pristine
 * copy keeps the server's relative refs, and {@link toRelativeMedia} reverses
 * the rewrite before uploads and change-detection so pushes round-trip exactly.
 *
 * `./media` is always relative to the page's own directory, so the reverse only
 * needs the file's path (no origin): an absolute URL is turned back into
 * `./media_…` only when its path segment matches that file's directory. Any
 * cross-directory or already-absolute media reference is left untouched.
 *
 * Pure (regex + string ops) so it stays testable and free of parser deps.
 */

// A media-bus filename: media_<hex hash>.<ext>, optionally followed by a
// #fragment or ?query rendering hint (preserved by the transforms below).
const MEDIA_NAME = 'media_[0-9a-f]+\\.[a-z0-9]+';
const RELATIVE_MEDIA_RE = new RegExp(`\\./(${MEDIA_NAME})`, 'gi');

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a path is an HTML document (the only files we transform).
 *
 * @param {string} daPath
 * @returns {boolean}
 */
export function isTransformableHtml(daPath) {
  return /\.html?$/i.test(daPath);
}

/**
 * The directory portion of a path, leading slash kept, no trailing slash;
 * empty string for a root-level file. `/docs/seo.html` → `/docs`; `/x.html` → ``.
 *
 * @param {string} daPath
 * @returns {string}
 */
export function mediaDir(daPath) {
  const norm = daPath.startsWith('/') ? daPath : `/${daPath}`;
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '' : norm.slice(0, idx);
}

/**
 * The site origin (scheme + host) for a preview URL, or '' if unparseable.
 *
 * @param {string} previewUrl
 * @returns {string}
 */
export function mediaOriginFor(previewUrl) {
  try {
    return new URL(previewUrl).origin;
  } catch {
    return '';
  }
}

/**
 * Rewrites relative `./media_…` refs in HTML to absolute URLs at `origin`,
 * resolved against the file's directory. No-op without an origin.
 *
 * @param {string} html
 * @param {string} origin - e.g. `https://main--repo--org.aem.page`
 * @param {string} daPath - the HTML file's path
 * @returns {string}
 */
export function toAbsoluteMedia(html, origin, daPath) {
  if (typeof html !== 'string' || !origin) {
    return html;
  }
  const prefix = `${origin}${mediaDir(daPath)}/`;
  return html.replace(RELATIVE_MEDIA_RE, (_m, name) => `${prefix}${name}`);
}

/**
 * Reverses {@link toAbsoluteMedia}: turns absolute media URLs that resolve to
 * this file's own directory back into `./media_…`. Origin-agnostic — matches
 * any host — so it also normalizes preview/live variants. Cross-directory
 * absolute refs are left as-is.
 *
 * @param {string} html
 * @param {string} daPath - the HTML file's path
 * @returns {string}
 */
export function toRelativeMedia(html, daPath) {
  if (typeof html !== 'string') {
    return html;
  }
  const dir = escapeRegExp(mediaDir(daPath));
  const re = new RegExp(`(?:https?:)?//[^/"'\\s)]+${dir}/(${MEDIA_NAME})`, 'gi');
  return html.replace(re, (_m, name) => `./${name}`);
}
