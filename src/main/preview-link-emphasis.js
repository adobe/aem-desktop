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
 * Flips da.live-style `<a><strong>…</strong></a>` (and nested `<em>` combos)
 * to `<strong><a>…</a></strong>` so site scripts like progressrail's
 * `decorateButtons` (`a.closest('strong')`) match upstream `.aem.page` output.
 */

/** @typedef {import('hast').Element} HastElement */
/** @typedef {import('hast').Root} HastRoot */

const EMPHASIS_TAGS = new Set(['strong', 'em']);

/**
 * @param {import('hast').Node} node
 * @returns {boolean}
 */
function isWhitespaceText(node) {
  return node.type === 'text' && !node.value.trim();
}

/**
 * @param {HastElement} anchor
 * @returns {{ chain: HastElement[], innerContent: import('hast').Node[] }|null}
 */
export function peelAnchorEmphasisChain(anchor) {
  if (anchor.type !== 'element' || anchor.tagName !== 'a') {
    return null;
  }

  /** @type {HastElement[]} */
  const chain = [];
  let current = anchor;

  while (true) {
    const kids = (current.children || []).filter((c) => !isWhitespaceText(c));
    if (kids.length !== 1 || kids[0].type !== 'element') {
      break;
    }
    const child = kids[0];
    if (!EMPHASIS_TAGS.has(child.tagName)) {
      break;
    }
    chain.push(child);
    current = child;
  }

  if (chain.length === 0) {
    return null;
  }

  const innerContent = current.children || [];
  if (innerContent.some((c) => c.type === 'element')) {
    return null;
  }

  return { chain, innerContent: [...innerContent] };
}

/**
 * @param {HastElement} anchorEl
 * @returns {boolean}
 */
export function isAnchorWrappingEmphasis(anchorEl) {
  return peelAnchorEmphasisChain(anchorEl) !== null;
}

/**
 * @param {HastElement} anchorEl
 * @returns {HastElement}
 */
export function flipAnchorWrappedEmphasis(anchorEl) {
  const peeled = peelAnchorEmphasisChain(anchorEl);
  if (!peeled) {
    return anchorEl;
  }

  const { chain, innerContent } = peeled;

  /** @type {HastElement} */
  let wrapped = {
    type: 'element',
    tagName: 'a',
    properties: { ...(anchorEl.properties || {}) },
    children: innerContent,
  };

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const emphasis = chain[i];
    wrapped = {
      type: 'element',
      tagName: emphasis.tagName,
      properties: { ...(emphasis.properties || {}) },
      children: [wrapped],
    };
  }

  return wrapped;
}

/**
 * @param {import('hast').Node} node
 * @returns {boolean}
 */
function flipOneAnchorWrappedEmphasis(node) {
  if (!('children' in node) || !Array.isArray(node.children)) {
    return false;
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child.type !== 'element') {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (flipOneAnchorWrappedEmphasis(child)) {
      return true;
    }
    if (child.tagName === 'a' && isAnchorWrappingEmphasis(child)) {
      // eslint-disable-next-line no-param-reassign
      node.children[i] = flipAnchorWrappedEmphasis(child);
      return true;
    }
  }
  return false;
}

/**
 * @param {HastRoot} tree
 * @returns {boolean} whether the tree was modified
 */
export function flipAnchorWrappedEmphasisInTree(tree) {
  let changed = false;
  while (flipOneAnchorWrappedEmphasis(tree)) {
    changed = true;
  }
  return changed;
}
