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
  flipAnchorWrappedEmphasis,
  flipAnchorWrappedEmphasisInTree,
  isAnchorWrappingEmphasis,
} from '../src/main/preview-link-emphasis.js';

const REHYPE_PARSE = { fragment: true };

function parse(html) {
  return unified().use(rehypeParse, REHYPE_PARSE).parse(html);
}

test('isAnchorWrappingEmphasis detects da.live-style links only', () => {
  const tree = parse('<p><a href="/x"><strong>Go</strong></a></p>');
  assert.equal(isAnchorWrappingEmphasis(tree.children[0].children[0]), true);

  const mixed = parse('<p><a href="/x"><strong>Go</strong> text</a></p>');
  assert.equal(isAnchorWrappingEmphasis(mixed.children[0].children[0]), false);

  const already = parse('<p><strong><a href="/x">Go</a></strong></p>');
  assert.equal(isAnchorWrappingEmphasis(already.children[0].children[0].children[0]), false);
});

test('flipAnchorWrappedEmphasis moves strong outside the anchor', () => {
  const anchor = parse('<a href="/x"><strong>Go</strong></a>').children[0];
  const flipped = flipAnchorWrappedEmphasis(anchor);
  assert.equal(flipped.tagName, 'strong');
  assert.equal(flipped.children[0].tagName, 'a');
  assert.equal(flipped.children[0].properties.href, '/x');
  assert.equal(flipped.children[0].children[0].value, 'Go');
});

test('flipAnchorWrappedEmphasisInTree handles nested em and strong wrappers', () => {
  const tree = parse('<p><a href="/x"><em><strong>Go</strong></em></a></p>');
  flipAnchorWrappedEmphasisInTree(tree);
  const html = toHtml(tree);
  assert.match(html, /<em><strong><a href="\/x">Go<\/a><\/strong><\/em>/);
  assert.doesNotMatch(html, /<a href="\/x"><em>/);
});

test('transformContentMetadataHtml flips da.live button links for decorateButtons', () => {
  const { htmlFragment } = transformContentMetadataHtml(
    '<p><a href="/en/company"><strong>LEARN MORE</strong></a></p>',
  );
  assert.match(htmlFragment, /<p><strong><a href="\/en\/company">LEARN MORE<\/a><\/strong><\/p>/);
  assert.doesNotMatch(htmlFragment, /<a href="[^"]+"><strong>/);
});
