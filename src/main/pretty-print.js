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

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const BLOCK_ELEMENTS = new Set([
  'html', 'head', 'body', 'div', 'section', 'article', 'aside', 'nav',
  'header', 'footer', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'form', 'fieldset', 'legend', 'details',
  'summary', 'figure', 'figcaption', 'blockquote', 'pre', 'address',
  'picture', 'video', 'audio', 'canvas', 'dialog', 'template',
]);

/**
 * @param {string} html
 * @returns {Array<{type: string, raw: string}>}
 */
function tokenize(html) {
  const tokens = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        tokens.push({ type: 'text', raw: html.slice(i) });
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('<!--') || tag.startsWith('<!')) {
        tokens.push({ type: 'comment', raw: tag });
      } else {
        tokens.push({ type: 'tag', raw: tag });
      }
      i = end + 1;
    } else {
      const next = html.indexOf('<', i);
      const text = next === -1 ? html.slice(i) : html.slice(i, next);
      if (text.trim()) {
        tokens.push({ type: 'text', raw: text });
      }
      i = next === -1 ? html.length : next;
    }
  }

  return tokens;
}

/**
 * @param {string} tag  e.g. '<div class="foo">' or '</div>'
 * @returns {string}    e.g. 'div'
 */
function extractTagName(tag) {
  const match = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Simple HTML pretty-printer that normalises indentation so diffs
 * are readable.  Does NOT parse a full DOM — it tokenises on `<` / `>`
 * and indents block-level elements.  Inline elements stay on one line.
 *
 * @param {string} html
 * @returns {string}
 */
export function prettyPrintHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const tokens = tokenize(html);
  const lines = [];
  let indent = 0;

  for (const token of tokens) {
    if (token.type === 'tag') {
      const tagName = extractTagName(token.raw);
      const isClose = token.raw.startsWith('</');
      const isSelfClose = token.raw.endsWith('/>') || VOID_ELEMENTS.has(tagName);
      const isBlock = BLOCK_ELEMENTS.has(tagName);

      if (isBlock && isClose) {
        indent = Math.max(0, indent - 1);
      }

      lines.push(`${'  '.repeat(indent)}${token.raw}`);

      if (isBlock && !isClose && !isSelfClose) {
        indent += 1;
      }
    } else if (token.type === 'text') {
      const trimmed = token.raw.trim();
      if (trimmed) {
        lines.push(`${'  '.repeat(indent)}${trimmed}`);
      }
    } else {
      // comments, doctype, etc.
      lines.push(`${'  '.repeat(indent)}${token.raw.trim()}`);
    }
  }

  return lines.join('\n');
}
