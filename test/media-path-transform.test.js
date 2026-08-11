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
  isTransformableHtml, mediaDir, mediaOriginFor, toAbsoluteMedia, toRelativeMedia,
} from '../src/main/media-path-transform.js';

const ORIGIN = 'https://main--aem-website--adobe.aem.page';

test('isTransformableHtml matches .html/.htm only', () => {
  assert.equal(isTransformableHtml('/docs/x.html'), true);
  assert.equal(isTransformableHtml('/docs/x.htm'), true);
  assert.equal(isTransformableHtml('/docs/x.json'), false);
  assert.equal(isTransformableHtml('/media_a1.png'), false);
});

test('mediaDir returns the directory, empty for root-level files', () => {
  assert.equal(mediaDir('/docs/seo-geo.html'), '/docs');
  assert.equal(mediaDir('/drafts/bohnert/test.html'), '/drafts/bohnert');
  assert.equal(mediaDir('/index.html'), '');
  assert.equal(mediaDir('index.html'), '');
});

test('mediaOriginFor returns the origin or empty string', () => {
  assert.equal(mediaOriginFor('https://main--x--y.aem.page/foo/bar'), 'https://main--x--y.aem.page');
  assert.equal(mediaOriginFor('not a url'), '');
});

test('toAbsoluteMedia rewrites ./media relative to the file dir, preserving the fragment', () => {
  const old = '<img src="./media_136be3193972adf8b8a54255b4b190a77d1450c32.png'
    + '#width=1672&height=941" loading="lazy">';
  assert.equal(
    toAbsoluteMedia(old, ORIGIN, '/docs/seo-geo.html'),
    '<img src="https://main--aem-website--adobe.aem.page/docs/'
      + 'media_136be3193972adf8b8a54255b4b190a77d1450c32.png#width=1672&height=941" loading="lazy">',
  );
});

test('toAbsoluteMedia handles a deeper dir and rewrites both srcset and src', () => {
  const old = '<source srcset="./media_1619342c9e91e4dbe69355c2679121170176a5bff.jpg'
    + '#width=1920&height=1076" media="(min-width: 600px)">'
    + '<img src="./media_1619342c9e91e4dbe69355c2679121170176a5bff.jpg'
    + '#width=1920&height=1076" loading="lazy">';
  const out = toAbsoluteMedia(old, ORIGIN, '/drafts/bohnert/test.html');
  const base = 'https://main--aem-website--adobe.aem.page/drafts/bohnert/'
    + 'media_1619342c9e91e4dbe69355c2679121170176a5bff.jpg#width=1920&height=1076';
  assert.equal(out, `<source srcset="${base}" media="(min-width: 600px)"><img src="${base}" loading="lazy">`);
});

test('toAbsoluteMedia on a root-level file has no dir segment', () => {
  assert.equal(
    toAbsoluteMedia('<img src="./media_abc123.png">', ORIGIN, '/index.html'),
    '<img src="https://main--aem-website--adobe.aem.page/media_abc123.png">',
  );
});

test('toAbsoluteMedia is a no-op without an origin', () => {
  const html = '<img src="./media_abc123.png">';
  assert.equal(toAbsoluteMedia(html, '', '/docs/x.html'), html);
});

test('toRelativeMedia reverses the rewrite for the same dir, any host', () => {
  assert.equal(
    toRelativeMedia(
      '<img src="https://main--aem-website--adobe.aem.page/docs/media_abc123.png#width=10">',
      '/docs/x.html',
    ),
    '<img src="./media_abc123.png#width=10">',
  );
  // Also normalizes the .aem.live sibling (origin-agnostic).
  assert.equal(
    toRelativeMedia(
      '<img src="https://main--aem-website--adobe.aem.live/docs/media_abc123.png">',
      '/docs/x.html',
    ),
    '<img src="./media_abc123.png">',
  );
});

test('toRelativeMedia leaves cross-directory absolute media untouched', () => {
  // File is /docs/x.html, but the media lives under /other → not a ./ ref.
  const html = '<img src="https://main--aem-website--adobe.aem.page/other/media_z.png">';
  assert.equal(toRelativeMedia(html, '/docs/x.html'), html);
});

test('forward then reverse round-trips exactly', () => {
  const original = '<source srcset="./media_1619342c9e91e4dbe69355c2679121170176a5bff.jpg#width=1920">'
    + '<img src="./media_1619342c9e91e4dbe69355c2679121170176a5bff.jpg#width=1920">'
    + '<a href="https://external.example.com/photo.jpg">ext</a>';
  const daPath = '/drafts/bohnert/test.html';
  const abs = toAbsoluteMedia(original, ORIGIN, daPath);
  assert.notEqual(abs, original);
  assert.equal(toRelativeMedia(abs, daPath), original);
});
