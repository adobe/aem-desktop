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
 * Diffs two document views (see `document-view-html.js`) into a track-changes
 * model: a flat list of blocks and section breaks, each marked as added,
 * removed, modified, or unchanged. Modified content carries inline
 * `<ins>`/`<del>` markup.
 */

import { parseDocumentHtml } from './document-view-html.js';
import { myersDiff } from './diff.js';

/** @typedef {import('./document-view-html.js').DocumentView} DocumentView */
/** @typedef {'added' | 'removed' | 'modified' | 'unchanged'} DiffChange */

/** @typedef {{ kind: 'break', change: DiffChange }} DiffBreakItem */
/** @typedef {{ kind: 'content', change: DiffChange, html: string }} DiffContentItem */
/** @typedef {{ change?: DiffChange, cells: string[] }} DiffRow */
/** @typedef {{
 *   kind: 'table',
 *   change: DiffChange,
 *   name: string,
 *   rows: DiffRow[],
 *   colSpan: number,
 * }} DiffTableItem */
/** @typedef {DiffBreakItem | DiffContentItem | DiffTableItem} DiffItem */
/** @typedef {{ changed: boolean, items: DiffItem[] }} DocumentDiffView */

const HTML_TOKEN = /<[^>]*>|[^<\s]+|\s+/g;

/**
 * @param {string} html
 * @returns {string[]}
 */
function tokenizeHtml(html) {
  return html.match(HTML_TOKEN) || [];
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isTagToken(token) {
  return token.startsWith('<');
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isImgToken(token) {
  return /^<img[\s/>]/i.test(token);
}

/**
 * Groups token edits into alternating equal / change segments.
 *
 * @param {ReturnType<typeof myersDiff>} edits
 * @returns {Array<{ type: 'equal', tokens: string[] }
 *   | { type: 'change', del: string[], ins: string[] }>}
 */
function buildSegments(edits) {
  const segments = [];
  for (const edit of edits) {
    const isEqual = edit.type === 'equal';
    let last = segments[segments.length - 1];
    if (!last || (last.type === 'equal') !== isEqual) {
      last = isEqual
        ? { type: 'equal', tokens: [] }
        : { type: 'change', del: [], ins: [] };
      segments.push(last);
    }
    if (isEqual) {
      last.tokens.push(edit.line);
    } else if (edit.type === 'delete') {
      last.del.push(edit.line);
    } else {
      last.ins.push(edit.line);
    }
  }
  return segments;
}

/**
 * @param {string[]} tokens
 * @returns {boolean}
 */
function hasWords(tokens) {
  return tokens.some((token) => token.trim() && !isTagToken(token));
}

/**
 * @param {{ type: string, del?: string[], ins?: string[] }} segment
 * @returns {boolean}
 */
function isReplacement(segment) {
  return segment.type === 'change' && hasWords(segment.del) && hasWords(segment.ins);
}

/** Max words in an equal run that still gets folded into a rewrite. */
const MERGEABLE_ANCHOR_WORDS = 2;

/**
 * @param {{ type: string, tokens?: string[] }} segment
 * @returns {boolean}
 */
function isMergeableAnchor(segment) {
  let words = 0;
  for (const token of segment.tokens) {
    if (isTagToken(token)) {
      return false;
    }
    if (token.trim()) {
      words += 1;
    }
  }
  return words <= MERGEABLE_ANCHOR_WORDS;
}

/**
 * A rewritten sentence usually shares whitespace and stray stopwords with its
 * replacement, which fragments the word diff into per-word del/ins pairs.
 * Fold short equal runs between two replacements into one del + one ins so
 * the whole rewrite reads as a single tracked change.
 *
 * @param {ReturnType<typeof buildSegments>} segments
 * @returns {ReturnType<typeof buildSegments>}
 */
function coalesceRewrites(segments) {
  const out = [];
  for (const segment of segments) {
    const anchor = out[out.length - 1];
    const prevChange = out[out.length - 2];
    if (
      isReplacement(segment)
      && anchor?.type === 'equal' && isMergeableAnchor(anchor)
      && prevChange && isReplacement(prevChange)
    ) {
      out.pop();
      prevChange.del.push(...anchor.tokens, ...segment.del);
      prevChange.ins.push(...anchor.tokens, ...segment.ins);
    } else {
      out.push(segment);
    }
  }
  return out;
}

/**
 * @param {string[]} tokens
 * @param {'del' | 'ins'} tag
 * @returns {string}
 */
function renderChangeSide(tokens, tag) {
  const out = [];
  let buf = [];

  const flushBuf = () => {
    if (buf.length === 0) {
      return;
    }
    const text = buf.join('');
    if (text.trim()) {
      out.push(`<${tag} class="da-diff-${tag}">${text}</${tag}>`);
    } else if (tag === 'ins') {
      out.push(text);
    }
    buf = [];
  };

  for (const token of tokens) {
    if (isTagToken(token)) {
      flushBuf();
      if (tag === 'ins') {
        out.push(token);
      } else if (isImgToken(token)) {
        out.push(`<del class="da-diff-del">${token}</del>`);
      }
    } else {
      buf.push(token);
    }
  }
  flushBuf();

  return out.join('');
}

/**
 * Word-level diff of two HTML fragments, producing markup with
 * `<ins>`/`<del>` wrappers around changed text runs. Tags are treated as
 * atomic tokens: inserted tags are kept as-is, deleted tags are dropped
 * (except images, which remain visible struck through) so the result stays
 * well-formed.
 *
 * @param {string} oldHtml
 * @param {string} newHtml
 * @returns {string}
 */
export function inlineHtmlDiff(oldHtml, newHtml) {
  const edits = myersDiff(tokenizeHtml(oldHtml), tokenizeHtml(newHtml));
  const segments = coalesceRewrites(buildSegments(edits));

  const out = [];
  for (const segment of segments) {
    if (segment.type === 'equal') {
      out.push(segment.tokens.join(''));
    } else {
      out.push(renderChangeSide(segment.del, 'del'));
      out.push(renderChangeSide(segment.ins, 'ins'));
    }
  }
  return out.join('');
}

/**
 * @param {DocumentView} view
 * @returns {Array<import('./document-view-html.js').DocumentBlock
 *   | { kind: 'break' }>}
 */
function flattenView(view) {
  const items = [];
  (view.sections || []).forEach((section, index) => {
    if (index > 0) {
      items.push({ kind: 'break' });
    }
    items.push(...section.blocks);
  });
  return items;
}

/**
 * @param {ReturnType<typeof flattenView>[number]} item
 * @returns {string}
 */
function itemKey(item) {
  if (item.kind === 'break') {
    return 'break';
  }
  if (item.kind === 'table') {
    return `table:${item.name}:${JSON.stringify(item.rows)}`;
  }
  return `content:${item.html}`;
}

/**
 * @param {ReturnType<typeof flattenView>[number]} item
 * @param {DiffChange} change
 * @returns {DiffItem}
 */
function toDiffItem(item, change) {
  if (item.kind === 'break') {
    return { kind: 'break', change };
  }
  if (item.kind === 'table') {
    return {
      kind: 'table',
      change,
      name: item.name,
      rows: item.rows.map((row) => ({ cells: row.cells })),
      colSpan: item.colSpan,
    };
  }
  return { kind: 'content', change, html: item.html };
}

/**
 * A removed block can be paired with an added one into a single "modified"
 * block when they are the same kind of thing.
 *
 * @param {ReturnType<typeof flattenView>[number]} oldItem
 * @param {ReturnType<typeof flattenView>[number]} newItem
 * @returns {boolean}
 */
function pairable(oldItem, newItem) {
  if (oldItem.kind === 'table' && newItem.kind === 'table') {
    return oldItem.name === newItem.name;
  }
  return oldItem.kind === 'content' && newItem.kind === 'content';
}

/**
 * @param {import('./document-view-html.js').DocumentTableBlock} oldBlock
 * @param {import('./document-view-html.js').DocumentTableBlock} newBlock
 * @returns {DiffTableItem}
 */
function diffTableBlocks(oldBlock, newBlock) {
  const edits = myersDiff(
    oldBlock.rows.map((row) => JSON.stringify(row.cells)),
    newBlock.rows.map((row) => JSON.stringify(row.cells)),
  );

  /** @type {DiffRow[]} */
  const rows = [];
  let delRun = [];
  let insRun = [];

  const flushRun = () => {
    const count = Math.max(delRun.length, insRun.length);
    for (let i = 0; i < count; i += 1) {
      const oldRow = delRun[i];
      const newRow = insRun[i];
      if (oldRow && newRow) {
        const cellCount = Math.max(oldRow.cells.length, newRow.cells.length);
        const cells = [];
        for (let c = 0; c < cellCount; c += 1) {
          cells.push(inlineHtmlDiff(oldRow.cells[c] ?? '', newRow.cells[c] ?? ''));
        }
        rows.push({ change: 'modified', cells });
      } else if (oldRow) {
        rows.push({ change: 'removed', cells: oldRow.cells });
      } else {
        rows.push({ change: 'added', cells: newRow.cells });
      }
    }
    delRun = [];
    insRun = [];
  };

  for (const edit of edits) {
    if (edit.type === 'equal') {
      flushRun();
      rows.push({ change: 'unchanged', cells: oldBlock.rows[edit.oldIdx].cells });
    } else if (edit.type === 'delete') {
      delRun.push(oldBlock.rows[edit.oldIdx]);
    } else {
      insRun.push(newBlock.rows[edit.newIdx]);
    }
  }
  flushRun();

  return {
    kind: 'table',
    change: 'modified',
    name: newBlock.name,
    rows,
    colSpan: Math.max(oldBlock.colSpan, newBlock.colSpan),
  };
}

/**
 * @param {DocumentView} oldView
 * @param {DocumentView} newView
 * @returns {DocumentDiffView}
 */
export function diffDocumentViews(oldView, newView) {
  const oldItems = flattenView(oldView);
  const newItems = flattenView(newView);
  const edits = myersDiff(oldItems.map(itemKey), newItems.map(itemKey));

  /** @type {DiffItem[]} */
  const items = [];
  let delRun = [];
  let insRun = [];

  const flushRun = () => {
    const count = Math.max(delRun.length, insRun.length);
    for (let i = 0; i < count; i += 1) {
      const oldItem = delRun[i];
      const newItem = insRun[i];
      if (oldItem && newItem && pairable(oldItem, newItem)) {
        if (oldItem.kind === 'table') {
          items.push(diffTableBlocks(oldItem, newItem));
        } else {
          items.push({
            kind: 'content',
            change: 'modified',
            html: inlineHtmlDiff(oldItem.html, newItem.html),
          });
        }
      } else {
        if (oldItem) {
          items.push(toDiffItem(oldItem, 'removed'));
        }
        if (newItem) {
          items.push(toDiffItem(newItem, 'added'));
        }
      }
    }
    delRun = [];
    insRun = [];
  };

  for (const edit of edits) {
    if (edit.type === 'equal') {
      flushRun();
      items.push(toDiffItem(oldItems[edit.oldIdx], 'unchanged'));
    } else if (edit.type === 'delete') {
      delRun.push(oldItems[edit.oldIdx]);
    } else {
      insRun.push(newItems[edit.newIdx]);
    }
  }
  flushRun();

  return {
    changed: items.some((item) => item.change !== 'unchanged'),
    items,
  };
}

/**
 * @param {string} oldHtml
 * @param {string} newHtml
 * @returns {DocumentDiffView}
 */
export function diffDocumentHtml(oldHtml, newHtml) {
  return diffDocumentViews(parseDocumentHtml(oldHtml), parseDocumentHtml(newHtml));
}
