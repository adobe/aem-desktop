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
  buildPreviewUrl,
  buildProxyPreviewUrl,
  buildUpstreamPreviewUrl,
  daPathToPreviewPath,
  isAllowedProxyPreviewNavigation,
  isSamePreviewOrigin,
  pathnameToPreviewPath,
  previewPathToLocalRelativePaths,
} from '../src/main/preview-url.js';

test('daPathToPreviewPath strips .html extension', () => {
  assert.equal(daPathToPreviewPath('/this.html'), '/this');
  assert.equal(daPathToPreviewPath('/blog/post.html'), '/blog/post');
});

test('daPathToPreviewPath maps index.html to directory paths', () => {
  assert.equal(daPathToPreviewPath('/that/index.html'), '/that/');
  assert.equal(daPathToPreviewPath('/index.html'), '/');
});

test('daPathToPreviewPath preserves .json extension', () => {
  assert.equal(daPathToPreviewPath('/this.json'), '/this.json');
  assert.equal(daPathToPreviewPath('/that/index.json'), '/that/index.json');
});

test('daPathToPreviewPath leaves asset paths unchanged', () => {
  assert.equal(daPathToPreviewPath('/styles.css'), '/styles.css');
  assert.equal(daPathToPreviewPath('/media/photo.jpg'), '/media/photo.jpg');
});

test('buildPreviewUrl combines origin and transformed path', () => {
  const origin = 'https://main--id--davidnuescheler.aem.page';
  assert.equal(
    buildPreviewUrl(origin, '/blog/post.html'),
    'https://main--id--davidnuescheler.aem.page/blog/post',
  );
  assert.equal(
    buildPreviewUrl(`${origin}/`, '/that/index.html'),
    'https://main--id--davidnuescheler.aem.page/that/',
  );
  assert.equal(
    buildPreviewUrl(origin, '/index.html'),
    'https://main--id--davidnuescheler.aem.page/',
  );
  assert.equal(
    buildPreviewUrl(origin, '/styles.css'),
    'https://main--id--davidnuescheler.aem.page/styles.css',
  );
});

test('isSamePreviewOrigin compares origins only', () => {
  const origin = 'https://main--id--davidnuescheler.aem.page';
  assert.equal(isSamePreviewOrigin(origin, `${origin}/blog`), true);
  assert.equal(isSamePreviewOrigin(origin, 'https://other.aem.page/'), false);
});

test('pathnameToPreviewPath normalizes request paths', () => {
  assert.equal(pathnameToPreviewPath('/'), '/');
  assert.equal(pathnameToPreviewPath('/iba'), '/iba');
  assert.equal(pathnameToPreviewPath('iba'), '/iba');
});

test('previewPathToLocalRelativePaths resolves html and json paths', () => {
  assert.deepEqual(previewPathToLocalRelativePaths('/'), ['index.html']);
  assert.deepEqual(previewPathToLocalRelativePaths('/that/'), ['that/index.html']);
  assert.deepEqual(previewPathToLocalRelativePaths('/blog/post'), ['blog/post.html']);
  assert.deepEqual(previewPathToLocalRelativePaths('/query-index.json'), ['query-index.json']);
});

test('buildProxyPreviewUrl serves at localhost root like helix-cli', () => {
  const built = buildProxyPreviewUrl('http://127.0.0.1:4567', '/iba.html');
  assert.equal(built.url, 'http://127.0.0.1:4567/iba');
  assert.equal(built.previewOrigin, 'http://127.0.0.1:4567');
});

test('isAllowedProxyPreviewNavigation allows same proxy origin only', () => {
  const origin = 'http://127.0.0.1:4567';
  assert.equal(isAllowedProxyPreviewNavigation(origin, `${origin}/iba`), true);
  assert.equal(isAllowedProxyPreviewNavigation(origin, `${origin}/styles.css`), true);
  assert.equal(isAllowedProxyPreviewNavigation(origin, 'https://example.com/'), false);
});

test('buildUpstreamPreviewUrl preserves preview path on .aem.page', () => {
  const origin = 'https://main--id--davidnuescheler.aem.page';
  assert.equal(
    buildUpstreamPreviewUrl(origin, '/blog/post', '?sheet=main'),
    'https://main--id--davidnuescheler.aem.page/blog/post?sheet=main',
  );
  assert.equal(
    buildUpstreamPreviewUrl(origin, '/'),
    'https://main--id--davidnuescheler.aem.page/',
  );
});
