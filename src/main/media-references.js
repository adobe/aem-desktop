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
 * Decides whether an uploaded document needs the helix6 source API to intern
 * external images (POST create) or can be replaced as-is (PUT). A document is
 * "already on the media bus" only when every <img> points at a same-origin
 * `media_<hash>` reference; any external image (cross-origin, or a non-media
 * source) means the server must fetch and intern it, which is the POST path.
 *
 * Kept dependency-free (regex + Node's URL) so it stays pure and testable and
 * doesn't pull an HTML parser into the da-sync / CLI import graph.
 */

// EDS/DA media-bus references are stored as `media_<hex-hash>.<ext>` (optionally
// with a query, e.g. `?width=750&format=png&optimize=medium`, stripped below).
const MEDIA_BASENAME_RE = /^media_[0-9a-f]+\.[a-z0-9]+$/i;

// One match per <img …> tag; the src is pulled out separately so attribute
// order doesn't matter.
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * Derives the set of hosts that count as "this site" for same-origin checks:
 * the preview host plus its aem.page/aem.live/hlx.page/hlx.live siblings.
 *
 * @param {string} previewUrl
 * @returns {string[]}
 */
export function deriveSiteHosts(previewUrl) {
  const hosts = new Set();
  try {
    const { host } = new URL(previewUrl);
    hosts.add(host);
    const match = host.match(/^(.*)\.(?:aem|hlx)\.(?:page|live)$/i);
    if (match) {
      const label = match[1];
      for (const domain of ['aem.page', 'aem.live', 'hlx.page', 'hlx.live']) {
        hosts.add(`${label}.${domain}`);
      }
    }
  } catch {
    // Malformed previewUrl — no same-origin hosts; absolute srcs count external.
  }
  return [...hosts];
}

/**
 * Whether a single <img> src is an already-interned, same-origin media-bus
 * reference. Relative srcs are same-origin by definition; absolute srcs must
 * match one of {@link deriveSiteHosts}. `data:`/`blob:` never count.
 *
 * @param {string} src
 * @param {string[]} [siteHosts]
 * @returns {boolean}
 */
export function isInternedMediaSrc(src, siteHosts = []) {
  if (typeof src !== 'string') {
    return false;
  }
  const value = src.trim();
  if (value === '' || /^(?:data|blob):/i.test(value)) {
    return false;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const protocolRelative = value.startsWith('//');

  let host = null;
  let pathname;
  try {
    if (hasScheme || protocolRelative) {
      const url = new URL(protocolRelative ? `https:${value}` : value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
      }
      host = url.host;
      pathname = url.pathname;
    } else {
      // Relative: resolve against a placeholder to drop any query/hash.
      pathname = new URL(value, 'https://placeholder.invalid/').pathname;
    }
  } catch {
    return false;
  }

  const basename = decodeURIComponent(pathname.split('/').pop() || '');
  if (!MEDIA_BASENAME_RE.test(basename)) {
    return false;
  }
  return host === null || siteHosts.includes(host);
}

/**
 * Extracts every `<img>` src from an HTML string.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function collectImgSrcs(html) {
  if (typeof html !== 'string' || html === '') {
    return [];
  }
  const srcs = [];
  const tags = html.match(IMG_TAG_RE) || [];
  for (const tag of tags) {
    const match = tag.match(SRC_ATTR_RE);
    const src = match && (match[1] ?? match[2] ?? match[3]);
    if (src) {
      srcs.push(src);
    }
  }
  return srcs;
}

/**
 * Whether an HTML document has any image the server must intern — i.e. some
 * <img> that is not an already-interned same-origin media-bus reference. A
 * document with no images (or only interned ones) can be replaced with PUT.
 *
 * @param {string} html
 * @param {string[]} [siteHosts]
 * @returns {boolean}
 */
export function htmlNeedsMediaInterning(html, siteHosts = []) {
  const srcs = collectImgSrcs(html);
  return srcs.some((src) => !isInternedMediaSrc(src, siteHosts));
}
