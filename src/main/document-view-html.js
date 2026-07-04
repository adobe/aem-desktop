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
 * Parses da.live / EDS content HTML into a document view model aligned with
 * `@da-tools/da-parser` (`aem2doc`) and the da-live ProseMirror editor.
 */

import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { toHtml } from 'hast-util-to-html';

/** @typedef {import('hast').Root} HastRoot */
/** @typedef {import('hast').Element} HastElement */
/** @typedef {import('hast').Nodes} HastNodes */

/** @typedef {{ cells: string[] }} DocumentRow */
/** @typedef {{
 *   kind: 'table',
 *   name: string,
 *   rows: DocumentRow[],
 *   colSpan: number,
 * }} DocumentTableBlock */
/** @typedef {{ kind: 'content', html: string }} DocumentContentBlock */
/** @typedef {DocumentTableBlock | DocumentContentBlock} DocumentBlock */
/** @typedef {{ blocks: DocumentBlock[] }} DocumentSection */
/** @typedef {{ sections: DocumentSection[] }} DocumentView */

const REHYPE_PARSE = { fragment: true };

/**
 * @param {HastNodes} node
 * @returns {string}
 */
function textContent(node) {
  if (node.type === 'text') {
    return node.value;
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(textContent).join('');
  }
  return '';
}

/**
 * @param {HastElement} node
 * @returns {string[]}
 */
function getClassList(node) {
  const cn = node.properties?.className;
  if (Array.isArray(cn)) {
    return cn.filter(Boolean);
  }
  if (typeof cn === 'string') {
    return cn.split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * @param {HastElement} node
 * @param {string} className
 * @returns {boolean}
 */
function hasClass(node, className) {
  return getClassList(node).includes(className);
}

/**
 * @param {string[]} classes
 * @returns {string}
 */
function formatBlockHeaderName(classes) {
  if (classes.length === 0) {
    return 'default';
  }
  const [name, ...options] = classes;
  if (options.length === 0) {
    return name;
  }
  return `${name} (${options.join(', ')})`;
}

/**
 * @param {HastElement} row
 * @returns {HastElement[]}
 */
function rowCells(row) {
  if (row.type !== 'element' || row.tagName !== 'div' || !row.children) {
    return [];
  }
  return row.children.filter((c) => c.type === 'element' && c.tagName === 'div');
}

/**
 * @param {HastElement} cell
 * @returns {string}
 */
function cellHtml(cell) {
  return toHtml(cell).replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
}

/**
 * @param {HastElement[]} rowDivs
 * @returns {DocumentRow[]}
 */
function rowsFromDivRows(rowDivs) {
  /** @type {DocumentRow[]} */
  const rows = [];
  for (const row of rowDivs) {
    if (row.type !== 'element') {
      // eslint-disable-next-line no-continue
      continue;
    }
    const cells = rowCells(row);
    if (cells.length >= 2) {
      rows.push({ cells: cells.map(cellHtml) });
    } else if (cells.length === 1) {
      rows.push({ cells: [cellHtml(cells[0])] });
    } else {
      rows.push({ cells: [toHtml(row)] });
    }
  }
  return rows;
}

/**
 * @param {HastElement} blockEl
 * @returns {number}
 */
function maxRowColumns(blockEl) {
  const rowDivs = (blockEl.children || []).filter(
    (c) => c.type === 'element' && c.tagName === 'div',
  );
  return rowDivs.reduce((max, row) => {
    if (row.type !== 'element') {
      return max;
    }
    return Math.max(max, rowCells(row).length);
  }, 1);
}

/**
 * @param {HastElement} node
 * @returns {HastElement|null}
 */
function findMetadataRoot(node) {
  if (hasClass(node, 'metadata') || hasClass(node, 'section-metadata')) {
    return node;
  }
  if (!node.children) {
    return null;
  }
  for (const child of node.children) {
    if (child.type === 'element') {
      const found = findMetadataRoot(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * @param {HastElement} blockEl
 * @returns {string|null}
 */
function tableHeaderName(blockEl) {
  const firstRow = blockEl.children?.find((c) => c.type === 'element' && c.tagName === 'div');
  if (!firstRow || firstRow.type !== 'element') {
    return null;
  }
  const cells = rowCells(firstRow);
  if (cells.length !== 1) {
    return null;
  }
  const name = textContent(cells[0]).trim();
  return name || null;
}

/**
 * @param {HastElement} blockEl
 * @returns {DocumentTableBlock|null}
 */
function tableBlockFromDiv(blockEl) {
  const metadataRoot = findMetadataRoot(blockEl);
  const classes = getClassList(blockEl);
  let headerName;

  if (metadataRoot) {
    headerName = hasClass(metadataRoot, 'section-metadata') ? 'section metadata' : 'metadata';
    const rows = rowsFromDivRows(
      (metadataRoot.children || []).filter((c) => c.type === 'element' && c.tagName === 'div'),
    );
    if (rows.length === 0) {
      return null;
    }
    const colSpan = rows.reduce((max, row) => Math.max(max, row.cells.length), 1);
    return {
      kind: 'table',
      name: headerName,
      rows,
      colSpan,
    };
  }

  if (classes.length > 0) {
    headerName = formatBlockHeaderName(classes);
    const rowDivs = (blockEl.children || []).filter(
      (c) => c.type === 'element' && c.tagName === 'div',
    );
    const rows = rowsFromDivRows(rowDivs);
    if (rows.length === 0) {
      return null;
    }
    return {
      kind: 'table',
      name: headerName,
      rows,
      colSpan: maxRowColumns(blockEl),
    };
  }

  const header = tableHeaderName(blockEl);
  if (!header) {
    return null;
  }

  const rowDivs = (blockEl.children || []).filter(
    (c) => c.type === 'element' && c.tagName === 'div',
  );
  const rows = rowsFromDivRows(rowDivs.slice(1));
  if (rows.length === 0) {
    return null;
  }

  return {
    kind: 'table',
    name: header,
    rows,
    colSpan: maxRowColumns(blockEl),
  };
}

/**
 * @param {HastNodes} node
 * @returns {DocumentBlock|null}
 */
function blockFromNode(node) {
  if (node.type !== 'element') {
    return null;
  }

  if (node.tagName === 'hr') {
    return null;
  }

  if (node.tagName === 'div') {
    const tableBlock = tableBlockFromDiv(node);
    if (tableBlock) {
      return tableBlock;
    }
    const html = toHtml(node).trim();
    if (!html) {
      return null;
    }
    return { kind: 'content', html };
  }

  return { kind: 'content', html: toHtml(node) };
}

/**
 * @param {HastNodes[]} nodes
 * @returns {DocumentBlock[]}
 */
function blocksFromNodes(nodes) {
  /** @type {DocumentBlock[]} */
  const blocks = [];
  for (const node of nodes) {
    const block = blockFromNode(node);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

/**
 * @param {HastRoot | HastElement} root
 * @returns {HastNodes[][]}
 */
function splitIntoSections(root) {
  const children = root.children || [];
  /** @type {HastNodes[][]} */
  const sections = [];
  /** @type {HastNodes[]} */
  let current = [];

  for (const node of children) {
    if (node.type === 'element' && node.tagName === 'hr') {
      if (current.length > 0) {
        sections.push(current);
        current = [];
      }
      // eslint-disable-next-line no-continue
      continue;
    }
    current.push(node);
  }

  if (current.length > 0) {
    sections.push(current);
  }

  return sections.length > 0 ? sections : [[]];
}

/**
 * Stored AEM pages wrap each section in a top-level `<main>` child `<div>`.
 *
 * @param {HastRoot} tree
 * @returns {HastNodes[][]}
 */
function sectionsFromMain(tree) {
  const main = tree.children.find(
    (c) => c.type === 'element' && c.tagName === 'main',
  );
  if (!main || main.type !== 'element') {
    return splitIntoSections(tree);
  }

  const hasHr = (main.children || []).some(
    (c) => c.type === 'element' && c.tagName === 'hr',
  );
  if (hasHr) {
    return splitIntoSections(main);
  }

  /** @type {HastNodes[][]} */
  const sections = [];
  /** @type {HastNodes[]} */
  let loose = [];

  for (const child of main.children || []) {
    if (child.type === 'element' && child.tagName === 'div') {
      if (loose.length > 0) {
        sections.push(loose);
        loose = [];
      }
      sections.push(child.children || []);
    } else {
      loose.push(child);
    }
  }

  if (loose.length > 0) {
    sections.push(loose);
  }

  return sections.length > 0 ? sections : [[]];
}

/**
 * @param {string} htmlFragment
 * @returns {DocumentView}
 */
export function parseDocumentHtml(htmlFragment) {
  const trimmed = htmlFragment.trim();
  if (!trimmed) {
    return { sections: [] };
  }

  /** @type {HastRoot} */
  let tree;
  try {
    tree = unified().use(rehypeParse, REHYPE_PARSE).parse(trimmed);
  } catch {
    return {
      sections: [{
        blocks: [{ kind: 'content', html: trimmed }],
      }],
    };
  }

  let sectionNodes = sectionsFromMain(tree);

  // Body fragments without <main>: sibling top-level divs are section wrappers.
  if (!tree.children.some((c) => c.type === 'element' && c.tagName === 'main')
    && !tree.children.some((c) => c.type === 'element' && c.tagName === 'hr')
    && tree.children.filter((c) => c.type === 'element' && c.tagName === 'div').length > 1) {
    sectionNodes = tree.children
      .filter((c) => c.type === 'element' && c.tagName === 'div')
      .map((div) => (div.type === 'element' ? div.children || [] : []));
  }

  const sections = sectionNodes.map((nodes) => ({
    blocks: blocksFromNodes(nodes),
  })).filter((section) => section.blocks.length > 0);

  return {
    sections: sections.length > 0 ? sections : [{ blocks: [] }],
  };
}
