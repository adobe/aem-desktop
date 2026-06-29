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
import { prepareLocalHtml } from '../src/main/preview-local.js';
import {
  rewritePreviewOriginHref,
  rewritePreviewOriginHrefs,
} from '../src/main/preview-href-rewrite.js';

const ORIGIN = 'https://main--id--org.aem.page';

test('rewritePreviewOriginHref converts upstream absolute URLs to root-relative paths', () => {
  assert.equal(
    rewritePreviewOriginHref(`${ORIGIN}/blog/post`, ORIGIN),
    '/blog/post',
  );
  assert.equal(rewritePreviewOriginHref(`${ORIGIN}/`, ORIGIN), '/');
  assert.equal(
    rewritePreviewOriginHref(`${ORIGIN}/search?q=1#top`, ORIGIN),
    '/search?q=1#top',
  );
});

test('rewritePreviewOriginHref leaves external and special hrefs unchanged', () => {
  assert.equal(
    rewritePreviewOriginHref('https://example.com/page', ORIGIN),
    'https://example.com/page',
  );
  assert.equal(rewritePreviewOriginHref('/already-relative', ORIGIN), '/already-relative');
  assert.equal(rewritePreviewOriginHref('#section', ORIGIN), '#section');
  assert.equal(rewritePreviewOriginHref('mailto:a@b.com', ORIGIN), 'mailto:a@b.com');
});

test('rewritePreviewOriginHrefs rewrites anchor and link hrefs in HTML', () => {
  const html = `<div>
  <a href="${ORIGIN}/iba">Home</a>
  <link rel="stylesheet" href="${ORIGIN}/styles.css"/>
  <a href="https://example.com/out">Out</a>
</div>`;
  const out = rewritePreviewOriginHrefs(html, ORIGIN);
  assert.match(out, /href="\/iba"/);
  assert.match(out, /href="\/styles\.css"/);
  assert.match(out, /href="https:\/\/example\.com\/out"/);
  assert.doesNotMatch(out, /aem\.page/);
});

test('prepareLocalHtml rewrites upstream hrefs in body and head', async () => {
  const html = `<p><a href="${ORIGIN}/next">Next</a></p>`;
  const out = await prepareLocalHtml(html, 'http://127.0.0.1:1/page', {
    headFragment: `<link rel="canonical" href="${ORIGIN}/page"/>`,
    localHtml: '',
    remoteDom: null,
    isModified: false,
  }, {
    previewUrlOrigin: ORIGIN,
  });

  assert.match(out, /<a href="\/next">Next<\/a>/);
  assert.match(out, /<link rel="canonical" href="\/page"\/?>/);
  assert.doesNotMatch(out, /aem\.page/);
});
