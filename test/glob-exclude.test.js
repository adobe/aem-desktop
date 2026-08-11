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
  globToRegExp, parseExcludeGlobs, isPathExcluded, applyExcludeGlobs,
} from '../src/main/glob-exclude.js';

test('globToRegExp matches the */recipes/* example across path depths', () => {
  const re = globToRegExp('*/recipes/*');
  assert.equal(re.test('/en/recipes/cake.html'), true);
  assert.equal(re.test('/en/food/recipes/cake.html'), true);
  assert.equal(re.test('/recipes/cake.html'), true);
  assert.equal(re.test('/en/dinner.html'), false);
});

test('globToRegExp escapes regex metacharacters and honors ?', () => {
  assert.equal(globToRegExp('*.json').test('/config.json'), true);
  assert.equal(globToRegExp('*.json').test('/config.jsonx'), false);
  assert.equal(globToRegExp('/a.b').test('/axb'), false); // '.' is literal
  assert.equal(globToRegExp('/a?b').test('/axb'), true); // '?' is one char
});

test('parseExcludeGlobs splits on commas, trims, and ignores blanks', () => {
  const matchers = parseExcludeGlobs(' */recipes/* , , */drafts/* ');
  assert.equal(matchers.length, 2);
  assert.equal(isPathExcluded('/en/recipes/x.html', matchers), true);
  assert.equal(isPathExcluded('/en/drafts/x.html', matchers), true);
  assert.equal(isPathExcluded('/en/index.html', matchers), false);
});

test('parseExcludeGlobs returns [] for empty input', () => {
  assert.deepEqual(parseExcludeGlobs(''), []);
  assert.deepEqual(parseExcludeGlobs(null), []);
  assert.deepEqual(parseExcludeGlobs(undefined), []);
});

test('applyExcludeGlobs filters files by daPath and is a no-op when empty', () => {
  const files = [
    { daPath: '/en/index.html' },
    { daPath: '/en/recipes/cake.html' },
    { daPath: '/en/drafts/wip.html' },
  ];
  assert.deepEqual(
    applyExcludeGlobs(files, '*/recipes/*, */drafts/*').map((f) => f.daPath),
    ['/en/index.html'],
  );
  assert.equal(applyExcludeGlobs(files, '').length, 3);
  assert.equal(applyExcludeGlobs(files, '   ').length, 3);
});
