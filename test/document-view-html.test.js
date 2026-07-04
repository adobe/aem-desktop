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
import { parseDocumentHtml } from '../src/main/document-view-html.js';

test('parseDocumentHtml extracts title, blocks, and section breaks', () => {
  const html = `<div>
  <h1>IBA Collections</h1>
</div>
<div>
  <div><div>widget</div></div>
  <div><a href="https://example.com/widget.html">https://example.com/widget.html</a></div>
</div>
<hr>
<div>
  <div class="metadata">
    <div><div>Image</div><div><img src="/image.jpg" alt=""></div></div>
  </div>
</div>`;

  const doc = parseDocumentHtml(html);

  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].blocks.length, 2);
  assert.equal(doc.sections[0].blocks[0].kind, 'content');
  assert.match(doc.sections[0].blocks[0].html, /IBA Collections/);
  assert.equal(doc.sections[0].blocks[1].kind, 'table');
  assert.equal(doc.sections[0].blocks[1].name, 'widget');
  assert.match(doc.sections[0].blocks[1].rows[0].cells[0], /example\.com\/widget\.html/);
  assert.equal(doc.sections[1].blocks[0].name, 'metadata');
  assert.equal(doc.sections[1].blocks[0].rows[0].cells[0], 'Image');
  assert.match(doc.sections[1].blocks[0].rows[0].cells[1], /image\.jpg/);
});

test('parseDocumentHtml handles class-named blocks like aem2doc', () => {
  const html = `<div class="columns center dark">
  <div><div>Left</div><div>Right</div></div>
</div>`;

  const doc = parseDocumentHtml(html);
  assert.equal(doc.sections[0].blocks[0].kind, 'table');
  assert.equal(doc.sections[0].blocks[0].name, 'columns (center, dark)');
  assert.equal(doc.sections[0].blocks[0].rows[0].cells[0], 'Left');
  assert.equal(doc.sections[0].blocks[0].rows[0].cells[1], 'Right');
});

test('parseDocumentHtml splits main section wrappers', () => {
  const html = `<main>
  <div>
    <div class="hero">
      <div><div>Title</div><div>Hero body</div></div>
    </div>
  </div>
  <div>
    <div class="section-metadata">
      <div><div>Style</div><div>dark</div></div>
    </div>
  </div>
</main>`;

  const doc = parseDocumentHtml(html);
  assert.equal(doc.sections.length, 2);
  assert.equal(doc.sections[0].blocks[0].name, 'hero');
  assert.equal(doc.sections[1].blocks[0].name, 'section metadata');
});

test('parseDocumentHtml renders default content outside tables', () => {
  const html = '<div><p>Intro paragraph</p></div>';
  const doc = parseDocumentHtml(html);
  assert.equal(doc.sections[0].blocks[0].kind, 'content');
  assert.match(doc.sections[0].blocks[0].html, /Intro paragraph/);
});
