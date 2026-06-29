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
import { transformContentMetadataHtml } from '../src/main/content-metadata-html.js';
import { wrapPreviewPageBody } from '../src/main/preview-page-shell.js';

test('wrapPreviewPageBody adds header main footer shell', () => {
  const out = wrapPreviewPageBody('<h1>Hello</h1>');
  assert.match(out, /^<header><\/header><main>/);
  assert.match(out, /<\/main><footer><\/footer>$/);
  assert.match(out, /<h1>Hello<\/h1>/);
});

test('wrapPreviewPageBody leaves documents that already have main unchanged', () => {
  const input = '<header></header><main><h1>Hello</h1></main><footer></footer>';
  assert.equal(wrapPreviewPageBody(input), input);
});

test('transformContentMetadataHtml preserves strong-wrapped links for decorateButtons', () => {
  const { htmlFragment } = transformContentMetadataHtml(
    '<p><a href="/en/company"><strong>LEARN MORE</strong></a></p>',
  );
  assert.match(htmlFragment, /<p><strong><a href="\/en\/company">LEARN MORE<\/a><\/strong><\/p>/);
  assert.doesNotMatch(htmlFragment, /<a href="[^"]+"><strong>/);
});
