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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { toHtml } from 'hast-util-to-html';
import { transformContentMetadataHtml } from '../src/main/content-metadata-html.js';
import {
  applySectionMetadataToTree,
  getValueFromNode,
  getStyleClassNames,
  toBlockCSSClassNames,
  toMetaName,
} from '../src/main/section-metadata-html.js';

const REHYPE_PARSE = { fragment: true };

function parseFragment(html) {
  return unified().use(rehypeParse, REHYPE_PARSE).parse(html);
}

test('toMetaName lowercases keys and normalizes invalid characters', () => {
  assert.equal(toMetaName('Section Margin'), 'section-margin');
});

test('toBlockCSSClassNames converts block option syntax in parentheses', () => {
  assert.deepEqual(toBlockCSSClassNames('Columns (fullsize, center)'), ['columns', 'fullsize', 'center']);
});

test('getStyleClassNames splits comma-separated style values', () => {
  const tree = parseFragment('<div>highlight, dark</div>');
  assert.deepEqual(getStyleClassNames(tree.children[0]), ['highlight', 'dark']);
});

test('applySectionMetadataToTree applies style as classes and other keys as data attributes', () => {
  const tree = parseFragment(`<div>
  <div class="section-metadata">
    <div><div>Style</div><div>highlight</div></div>
    <div><div>background</div><div>blue</div></div>
  </div>
  <h1>Hello</h1>
</div>`);

  applySectionMetadataToTree(tree);
  const html = toHtml(tree);

  assert.match(html, /class="[^"]*highlight/);
  assert.match(html, /data-background="blue"/);
  assert.doesNotMatch(html, /section-metadata/);
  assert.match(html, /<h1>Hello<\/h1>/);
});

test('applySectionMetadataToTree sets id from section metadata id row', () => {
  const tree = parseFragment(`<div>
  <div class="section-metadata">
    <div><div>id</div><div>get-started</div></div>
  </div>
  <h2>Start</h2>
</div>`);

  applySectionMetadataToTree(tree);
  const html = toHtml(tree);

  assert.match(html, /id="get-started"/);
  assert.doesNotMatch(html, /section-metadata/);
});

test('getValueFromNode extracts link hrefs and resolves relative URLs', () => {
  const tree = parseFragment('<div><a href="/path">link</a></div>');
  const valueNode = tree.children[0];
  assert.equal(
    getValueFromNode(valueNode, 'http://127.0.0.1:1/page'),
    'http://127.0.0.1:1/path',
  );
});

test('getStyleClassNames splits values on hard breaks', () => {
  const tree = parseFragment('<div>two-columns<br>dark</div>');
  assert.deepEqual(getStyleClassNames(tree.children[0]), ['two-columns', 'dark']);
});

test('transformContentMetadataHtml applies section metadata even without page metadata', () => {
  const html = `<div>
  <div class="section-metadata">
    <div><div>Style</div><div>dark</div></div>
  </div>
  <p>Body</p>
</div>`;
  const { htmlFragment } = transformContentMetadataHtml(html);

  assert.match(htmlFragment, /class="[^"]*dark/);
  assert.doesNotMatch(htmlFragment, /section-metadata/);
});

test('prepareLocalHtml path transforms section metadata through transformContentMetadataHtml', async () => {
  const { prepareLocalHtml } = await import('../src/main/preview-local.js');
  const html = `<div>
  <div class="section-metadata">
    <div><div>Style</div><div>light</div></div>
    <div><div>Section Margin</div><div>0</div></div>
  </div>
  <h1>Preview</h1>
</div>`;
  const out = await prepareLocalHtml(html, 'http://127.0.0.1:1/preview', {
    headFragment: '',
    localHtml: '',
    remoteDom: null,
    isModified: false,
  });

  assert.match(out, /class="[^"]*light/);
  assert.match(out, /data-section-margin="0"/);
  assert.doesNotMatch(out, /section-metadata/);
});
