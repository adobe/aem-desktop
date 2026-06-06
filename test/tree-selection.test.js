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
  applyFinderClick,
  collectVisibleItems,
  selectAllPaths,
} from '../src/renderer/tree-selection.js';

test('collectVisibleItems walks expanded folders only', () => {
  const cache = {
    '/': [
      { daPath: '/a', name: 'a', isFolder: true },
      {
        daPath: '/readme.md', name: 'readme', ext: 'md', isFolder: false,
      },
    ],
    '/a': [
      { daPath: '/a/b', name: 'b', isFolder: true },
    ],
    '/a/b': [
      {
        daPath: '/a/b/page.html', name: 'page', ext: 'html', isFolder: false,
      },
    ],
  };

  const collapsed = collectVisibleItems(cache, new Set(['/']));
  assert.equal(collapsed.length, 2);

  const expanded = collectVisibleItems(cache, new Set(['/', '/a', '/a/b']));
  assert.equal(expanded.length, 4);
});

test('applyFinderClick replaces selection on plain click', () => {
  const result = applyFinderClick({
    visiblePaths: ['/a', '/b', '/c'],
    selectedPaths: new Set(['/a']),
    anchorPath: '/a',
    daPath: '/b',
    metaKey: false,
    shiftKey: false,
  });
  assert.deepEqual([...result.selectedPaths], ['/b']);
  assert.equal(result.anchorPath, '/b');
});

test('applyFinderClick toggles with meta key', () => {
  const add = applyFinderClick({
    visiblePaths: ['/a', '/b'],
    selectedPaths: new Set(['/a']),
    anchorPath: '/a',
    daPath: '/b',
    metaKey: true,
    shiftKey: false,
  });
  assert.deepEqual([...add.selectedPaths].sort(), ['/a', '/b']);

  const remove = applyFinderClick({
    visiblePaths: ['/a', '/b'],
    selectedPaths: add.selectedPaths,
    anchorPath: '/b',
    daPath: '/a',
    metaKey: true,
    shiftKey: false,
  });
  assert.deepEqual([...remove.selectedPaths], ['/b']);
});

test('applyFinderClick selects range with shift key', () => {
  const result = applyFinderClick({
    visiblePaths: ['/a', '/b', '/c', '/d'],
    selectedPaths: new Set(['/a']),
    anchorPath: '/a',
    daPath: '/c',
    metaKey: false,
    shiftKey: true,
  });
  assert.deepEqual([...result.selectedPaths], ['/a', '/b', '/c']);
});

test('applyFinderClick adds range with meta+shift', () => {
  const result = applyFinderClick({
    visiblePaths: ['/a', '/b', '/c', '/d'],
    selectedPaths: new Set(['/d']),
    anchorPath: '/d',
    daPath: '/b',
    metaKey: true,
    shiftKey: true,
  });
  assert.deepEqual([...result.selectedPaths].sort(), ['/b', '/c', '/d']);
});

test('selectAllPaths selects every visible path', () => {
  const all = selectAllPaths(['/a', '/b']);
  assert.deepEqual([...all], ['/a', '/b']);
});
