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
import {
  deriveSiteHosts, isInternedMediaSrc, collectImgSrcs, htmlNeedsMediaInterning,
} from '../src/main/media-references.js';

const HOSTS = deriveSiteHosts('https://main--wheelercat--aemsites.aem.page');

test('deriveSiteHosts includes the preview host and its aem/hlx siblings', () => {
  assert.deepEqual(new Set(HOSTS), new Set([
    'main--wheelercat--aemsites.aem.page',
    'main--wheelercat--aemsites.aem.live',
    'main--wheelercat--aemsites.hlx.page',
    'main--wheelercat--aemsites.hlx.live',
  ]));
});

test('deriveSiteHosts tolerates a malformed url', () => {
  assert.deepEqual(deriveSiteHosts('not a url'), []);
});

test('isInternedMediaSrc: relative media_ refs are interned (same-origin)', () => {
  assert.equal(isInternedMediaSrc('./media_1a2b3c4d.png', HOSTS), true);
  assert.equal(isInternedMediaSrc('/media_deadbeef.jpeg', HOSTS), true);
  // Query strings (width/format/optimize) are ignored.
  assert.equal(
    isInternedMediaSrc('./media_abc123.png?width=750&format=png&optimize=medium', HOSTS),
    true,
  );
});

test('isInternedMediaSrc: absolute same-origin media_ refs are interned', () => {
  assert.equal(
    isInternedMediaSrc('https://main--wheelercat--aemsites.aem.live/media_abc123.png', HOSTS),
    true,
  );
});

test('isInternedMediaSrc: cross-origin or non-media refs are not interned', () => {
  // Cross-origin, even with a media_ basename → still external.
  assert.equal(isInternedMediaSrc('https://cdn.example.com/media_abc123.png', HOSTS), false);
  // Same-origin but not a media_ reference.
  assert.equal(isInternedMediaSrc('./images/photo.png', HOSTS), false);
  // External absolute image.
  assert.equal(isInternedMediaSrc('https://example.com/photo.jpg', HOSTS), false);
  // Inline data URI.
  assert.equal(isInternedMediaSrc('data:image/png;base64,AAAA', HOSTS), false);
  assert.equal(isInternedMediaSrc('', HOSTS), false);
});

test('isInternedMediaSrc: protocol-relative same-origin media_ ref is interned', () => {
  assert.equal(
    isInternedMediaSrc('//main--wheelercat--aemsites.aem.page/media_abc123.png', HOSTS),
    true,
  );
});

test('collectImgSrcs extracts src from mixed quoting and attribute order', () => {
  const html = '<p>x</p><img src="./media_a.png">'
    + "<img alt='y' src='https://cdn.example.com/b.png' >"
    + '<img data-foo="1" src=/media_c.png loading="lazy">'
    + '<img>';
  assert.deepEqual(collectImgSrcs(html), [
    './media_a.png',
    'https://cdn.example.com/b.png',
    '/media_c.png',
  ]);
});

test('collectImgSrcs returns [] for empty/non-string', () => {
  assert.deepEqual(collectImgSrcs(''), []);
  assert.deepEqual(collectImgSrcs(undefined), []);
});

test('htmlNeedsMediaInterning: false when no images or all interned', () => {
  assert.equal(htmlNeedsMediaInterning('<p>no images here</p>', HOSTS), false);
  assert.equal(
    htmlNeedsMediaInterning('<img src="./media_a1.png"><img src="/media_b2.jpg">', HOSTS),
    false,
  );
});

test('htmlNeedsMediaInterning: true when any image is external', () => {
  assert.equal(
    htmlNeedsMediaInterning(
      '<img src="./media_a1.png"><img src="https://cdn.example.com/x.png">',
      HOSTS,
    ),
    true,
  );
});
