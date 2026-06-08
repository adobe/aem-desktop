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
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createHeadHtmlCache,
  readLocalHeadHtml,
  resolveHeadHtml,
} from '../src/main/head-html.js';
import {
  prepareLocalHtml,
  readLocalPreviewContent,
  resolveLocalContentFile,
} from '../src/main/preview-local.js';

test('resolveLocalContentFile maps clean preview paths to .html files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  await mkdir(join(root, 'blog'), { recursive: true });
  await writeFile(join(root, 'blog', 'post.html'), '<p>local</p>');
  const resolved = await resolveLocalContentFile(root, '/blog/post');
  assert.equal(resolved?.relativePath, 'blog/post.html');
});

test('resolveLocalContentFile finds index.html for directory paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  await mkdir(join(root, 'that'), { recursive: true });
  await writeFile(join(root, 'that', 'index.html'), '<p>index</p>');
  const resolved = await resolveLocalContentFile(root, '/that/');
  assert.equal(resolved?.relativePath, 'that/index.html');
});

test('prepareLocalHtml wraps body-only HTML with head fragment and meta tags', async () => {
  const html = `<div class="metadata">
<div>Title</div><div>Hello</div>
</div>
<h1>Hello</h1>`;
  const out = await prepareLocalHtml(html, 'http://127.0.0.1:1/iba', {
    headFragment: '<link rel="stylesheet" href="/styles.css"/>',
    localHtml: '',
    remoteDom: null,
    isModified: false,
  });
  assert.match(out, /<meta property="og:title" content="Hello">/);
  assert.doesNotMatch(out, /class="metadata"/);
  assert.match(out, /<link rel="stylesheet" href="\/styles\.css"\/>/);
});

test('readLocalPreviewContent serves local json unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  await writeFile(join(root, 'query-index.json'), '{"data":[]}\n');
  const { body, contentType } = await readLocalPreviewContent(
    join(root, 'query-index.json'),
    'query-index.json',
    'http://127.0.0.1:1/query-index.json',
    {
      headFragment: '',
      localHtml: '',
      remoteDom: null,
      isModified: false,
    },
  );
  assert.equal(contentType, 'application/json; charset=utf-8');
  assert.equal(body, '{"data":[]}\n');
});

test('resolveHeadHtml fetches remote head.html when no local file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  const cache = new Map();
  const fetchFn = async (_) => ({
    ok: true,
    text: async () => '<link rel="stylesheet" href="/theme.css"/>',
  });

  const resolved = await resolveHeadHtml({
    previewUrlOrigin: 'https://main--id--org.aem.page',
    syncRootDir: root,
    cache,
    fetchFn,
  });

  assert.match(resolved.headFragment, /theme\.css/);
  assert.equal(resolved.isModified, false);
});

test('resolveHeadHtml prefers local head.html over remote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  await writeFile(join(root, 'head.html'), '<!-- local -->\n<link rel="stylesheet" href="/local.css"/>');
  const cache = new Map();
  cache.set('https://main--id--org.aem.page', {
    html: '<link rel="stylesheet" href="/remote.css"/>',
    dom: null,
  });

  const resolved = await resolveHeadHtml({
    previewUrlOrigin: 'https://main--id--org.aem.page',
    syncRootDir: root,
    cache,
  });

  assert.match(resolved.headFragment, /local\.css/);
  assert.equal(resolved.isModified, true);
});

test('createHeadHtmlCache caches remote head per origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aem-preview-'));
  let calls = 0;
  const store = createHeadHtmlCache();
  const fetchFn = async () => {
    calls += 1;
    return { ok: true, text: async () => '<meta name="x" content="1"/>' };
  };

  await store.resolve({
    previewUrlOrigin: 'https://main--id--org.aem.page',
    syncRootDir: root,
    fetchFn,
  });
  await store.resolve({
    previewUrlOrigin: 'https://main--id--org.aem.page',
    syncRootDir: root,
    fetchFn,
  });

  assert.equal(calls, 1);
  assert.equal(await readLocalHeadHtml(root), '');
});
