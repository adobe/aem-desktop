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
 * Transforms da.live-style `<div class="section-metadata">` blocks into section
 * attributes for local preview: `style` values become CSS classes, other keys
 * become `data-*` attributes, and the block is removed from the DOM.
 */

/** @typedef {import('hast').Root} HastRoot */
/** @typedef {import('hast').Element} HastElement */

/**
 * @param {string} text
 * @returns {string}
 */
export function toMetaName(text) {
  const name = text.replace(/[^0-9a-zA-Z:_-]/g, '-');
  if (name.toLowerCase().startsWith('hreflang-')) {
    return `hreflang-${name.substring(9)}`;
  }
  return name.toLowerCase();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function toSectionId(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^0-9a-z._:-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function toBlockCSSClassNames(text) {
  if (!text) {
    return [];
  }
  const names = [];
  const idx = text.lastIndexOf('(');
  if (idx >= 0) {
    names.push(text.substring(0, idx));
    names.push(...text.substring(idx + 1).split(','));
  } else {
    names.push(text);
  }

  return names.map((name) => name
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, ''))
    .filter((name) => !!name);
}

/**
 * @param {HastElement} node
 * @param {string} className
 * @returns {boolean}
 */
function hasClass(node, className) {
  const cn = node.properties?.className;
  if (Array.isArray(cn)) {
    return cn.includes(className);
  }
  if (typeof cn === 'string') {
    return cn.split(/\s+/).includes(className);
  }
  return false;
}

/**
 * @param {import('hast').Node} node
 * @returns {string}
 */
function getLabelText(node) {
  if (node.type === 'text') {
    return node.value;
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((c) => getLabelText(c)).join('');
  }
  return '';
}

/**
 * @param {HastElement} element
 * @param {string[]} classNames
 */
function addClasses(element, classNames) {
  if (classNames.length === 0) {
    return;
  }
  const existing = element.properties?.className;
  if (Array.isArray(existing)) {
    existing.push(...classNames);
    return;
  }
  const props = { ...(element.properties || {}) };
  if (typeof existing === 'string') {
    props.className = [...existing.split(/\s+/).filter(Boolean), ...classNames];
  } else {
    props.className = classNames;
  }
  // eslint-disable-next-line no-param-reassign
  element.properties = props;
}

/**
 * @param {string} href
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveUrl(href, baseUrl) {
  if (!href || href.startsWith('https://') || href.startsWith('http://')) {
    return href;
  }
  if (!baseUrl) {
    return href;
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * @param {import('hast').Node} valueNode
 * @param {string} baseUrl
 * @returns {string}
 */
export function getValueFromNode(valueNode, baseUrl = '') {
  /** @type {string[]} */
  const items = [];

  /**
   * @param {import('hast').Node} node
   */
  function walk(node) {
    if (node.type === 'text') {
      items.push(...node.value.split(',').map((s) => s.trim()).filter(Boolean));
      return;
    }
    if (node.type !== 'element') {
      return;
    }
    if (node.tagName === 'br') {
      return;
    }
    if (node.tagName === 'img' && node.properties?.src) {
      items.push(resolveUrl(String(node.properties.src), baseUrl));
      return;
    }
    if (node.tagName === 'a' && node.properties?.href) {
      items.push(resolveUrl(String(node.properties.href), baseUrl));
      return;
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(valueNode);
  return items.join(',');
}

/**
 * @param {import('hast').Node} valueNode
 * @returns {string[]}
 */
export function getStyleClassNames(valueNode) {
  /** @type {string[]} */
  const parts = [];

  /**
   * @param {import('hast').Node} node
   */
  function walk(node) {
    if (node.type === 'text') {
      parts.push(...node.value.split(','));
      return;
    }
    if (node.type !== 'element') {
      return;
    }
    if (node.tagName === 'br') {
      return;
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(valueNode);
  return parts.flatMap(toBlockCSSClassNames);
}

/**
 * @param {import('hast').Node} tree
 * @param {import('hast').Element} target
 * @returns {boolean}
 */
function removeNode(tree, target) {
  if (tree === target) {
    return true;
  }
  if ('children' in tree && Array.isArray(tree.children)) {
    const { children } = tree;
    for (let i = 0; i < children.length; i += 1) {
      const c = children[i];
      if (c === target) {
        children.splice(i, 1);
        return true;
      }
      if (removeNode(c, target)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {import('hast').Node} node
 * @param {import('hast').Node | null} parent
 * @param {Array<{ metadataEl: HastElement, sectionEl: HastElement }>} results
 */
function collectSectionMetadataBlocks(node, parent, results) {
  if (
    node.type === 'element'
    && node.tagName === 'div'
    && hasClass(node, 'section-metadata')
    && parent?.type === 'element'
  ) {
    results.push({ metadataEl: node, sectionEl: parent });
    return;
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectSectionMetadataBlocks(child, node, results);
    }
  }
}

/**
 * @param {HastElement} sectionEl
 * @param {HastElement} metadataEl
 * @param {{ baseUrl?: string }} [options]
 */
export function applySectionMetadata(sectionEl, metadataEl, options = {}) {
  const { baseUrl = '' } = options;
  if (!metadataEl.children) {
    return;
  }

  for (const row of metadataEl.children) {
    if (row.type !== 'element' || row.tagName !== 'div' || !row.children?.[1]) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const cells = row.children.filter((c) => c.type === 'element' && c.tagName === 'div');
    if (cells.length < 2) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const [$name, $value] = cells;
    const name = toMetaName(getLabelText($name));
    if (!name) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (name === 'style') {
      addClasses(sectionEl, getStyleClassNames($value));
    } else if (name === 'id') {
      const id = toSectionId(getValueFromNode($value, baseUrl));
      if (id) {
        // eslint-disable-next-line no-param-reassign
        sectionEl.properties = { ...(sectionEl.properties || {}), id };
      }
    } else {
      // eslint-disable-next-line no-param-reassign
      sectionEl.properties = {
        ...(sectionEl.properties || {}),
        [`data-${name}`]: getValueFromNode($value, baseUrl),
      };
    }
  }
}

/**
 * @param {HastRoot} tree
 * @param {{ baseUrl?: string }} [options]
 */
export function applySectionMetadataToTree(tree, options = {}) {
  /** @type {Array<{ metadataEl: HastElement, sectionEl: HastElement }>} */
  const blocks = [];
  collectSectionMetadataBlocks(tree, null, blocks);

  for (const { metadataEl, sectionEl } of blocks) {
    applySectionMetadata(sectionEl, metadataEl, options);
    removeNode(tree, metadataEl);
  }
}
