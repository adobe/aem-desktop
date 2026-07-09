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
  buildDesktopRumPath,
  desktopRumReferer,
  normalizeDaPathForRum,
} from '../src/renderer/rum-paths.js';
import { DESKTOP_RUM_ORIGIN } from '../src/rum-config.js';

test('normalizeDaPathForRum keeps leading slash', () => {
  assert.equal(normalizeDaPathForRum('blog/post'), '/blog/post');
  assert.equal(normalizeDaPathForRum('/blog/post'), '/blog/post');
  assert.equal(normalizeDaPathForRum('/'), '');
});

test('buildDesktopRumPath maps shell views to virtual URLs', () => {
  assert.equal(buildDesktopRumPath('home', null), '/');
  assert.equal(
    buildDesktopRumPath('browse', { org: 'acme', repo: 'site' }),
    '/sites/acme/site',
  );
  assert.equal(
    buildDesktopRumPath('browse', { org: 'acme', repo: 'site' }, '/blog/post'),
    '/sites/acme/site/content/blog/post',
  );
  assert.equal(
    buildDesktopRumPath('review', { org: 'acme', repo: 'site' }),
    '/sites/acme/site/review',
  );
});

test('desktopRumReferer prefixes desktop origin', () => {
  assert.equal(desktopRumReferer('/'), `${DESKTOP_RUM_ORIGIN}/`);
  assert.equal(
    desktopRumReferer('/sites/acme/site'),
    `${DESKTOP_RUM_ORIGIN}/sites/acme/site`,
  );
});
