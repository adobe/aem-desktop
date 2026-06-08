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
 * @param {string} name
 * @returns {'json'|'html'|'text'}
 */
export function detectFormat(name, contentType = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json') || contentType.includes('json')) {
    return 'json';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm') || contentType.includes('html')) {
    return 'html';
  }
  return 'text';
}

/**
 * Pretty-prints JSON when possible.
 *
 * @param {string} body
 * @returns {{ format: 'json', text: string }|{ format: 'text', text: string }}
 */
export function formatJsonBody(body) {
  try {
    const parsed = JSON.parse(body);
    return { format: 'json', text: `${JSON.stringify(parsed, null, 2)}\n` };
  } catch {
    return { format: 'text', text: body };
  }
}

/**
 * Indents HTML for readable source display.
 *
 * @param {string} html
 * @returns {string}
 */
export function prettyPrintHtml(html) {
  const trimmed = html.trim();
  if (!trimmed) {
    return '';
  }

  const tokens = trimmed
    .replace(/>\s+</g, '><')
    .replace(/(<[^>]+>)/g, '\n$1\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let indent = 0;
  const lines = [];

  for (const token of tokens) {
    const isClosing = /^<\/.+>/.test(token);
    const isSelfClosing = /\/>$/.test(token) || /^<!/.test(token);
    const isOpening = /^<[^!/][^>]*>$/.test(token) && !isSelfClosing;

    if (isClosing) {
      indent = Math.max(0, indent - 1);
    }

    lines.push(`${'  '.repeat(indent)}${token}`);

    if (isOpening) {
      indent += 1;
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Prepares file content for display in the renderer.
 *
 * @param {{ name: string, contentType: string, body: string, isText: boolean }} input
 * @returns {{ mode: 'json'|'html'|'text'|'binary', text: string }}
 */
export function formatContentForDisplay({
  name, contentType, body, isText,
}) {
  if (!isText) {
    return { mode: 'binary', text: 'Binary content cannot be displayed.' };
  }

  const kind = detectFormat(name, contentType);
  if (kind === 'json') {
    const formatted = formatJsonBody(body);
    return { mode: formatted.format, text: formatted.text };
  }
  if (kind === 'html') {
    return { mode: 'html', text: prettyPrintHtml(body) };
  }
  return { mode: 'text', text: body };
}
