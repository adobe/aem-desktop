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
 * Rewrites absolute upstream preview URLs in `href` attributes to root-relative paths
 * so local preview navigation stays on the localhost proxy.
 */

import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { toHtml } from 'hast-util-to-html';

const REHYPE_PARSE = { fragment: true };

const SKIP_HREF_PREFIXES = ['#', 'mailto:', 'tel:', 'data:'];

/**
 * @param {string} href
 * @returns {boolean}
 */
function isSkippableHref(href) {
  const lower = href.trim().toLowerCase();
  // eslint-disable-next-line no-script-url -- preserve javascript: hrefs unchanged
  if (lower.startsWith('javascript:')) {
    return true;
  }
  return SKIP_HREF_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * @param {string} href
 * @param {string} previewUrlOrigin
 * @returns {string}
 */
export function rewritePreviewOriginHref(href, previewUrlOrigin) {
  if (typeof href !== 'string' || !href || !previewUrlOrigin) {
    return href;
  }

  const trimmed = href.trim();
  if (isSkippableHref(trimmed)) {
    return href;
  }

  try {
    const origin = previewUrlOrigin.replace(/\/+$/, '');
    const resolved = new URL(trimmed, `${origin}/`);
    if (resolved.origin !== new URL(origin).origin) {
      return href;
    }

    let path = resolved.pathname || '/';
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }
    return `${path}${resolved.search}${resolved.hash}`;
  } catch {
    return href;
  }
}

/**
 * @param {import('hast').Node} node
 * @param {string} previewUrlOrigin
 * @returns {boolean} whether any href was rewritten
 */
function rewriteHrefsInTree(node, previewUrlOrigin) {
  let changed = false;
  if (node.type === 'element' && node.properties?.href) {
    const current = node.properties.href;
    if (typeof current === 'string') {
      const next = rewritePreviewOriginHref(current, previewUrlOrigin);
      if (next !== current) {
        // eslint-disable-next-line no-param-reassign
        node.properties.href = next;
        changed = true;
      }
    }
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (rewriteHrefsInTree(child, previewUrlOrigin)) {
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * @param {string} html
 * @param {string} previewUrlOrigin
 * @returns {string}
 */
export function rewritePreviewOriginHrefs(html, previewUrlOrigin) {
  if (!html || !previewUrlOrigin) {
    return html;
  }

  let tree;
  try {
    tree = unified().use(rehypeParse, REHYPE_PARSE).parse(html);
  } catch {
    return html;
  }

  if (!rewriteHrefsInTree(tree, previewUrlOrigin)) {
    return html;
  }
  return toHtml(tree);
}
