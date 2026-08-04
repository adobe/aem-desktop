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
import { jsonToSheets, formatCell } from '../src/renderer/json-table.js';

test('formatCell stringifies primitives, objects, and nullish values', () => {
  assert.equal(formatCell('hi'), 'hi');
  assert.equal(formatCell(42), '42');
  assert.equal(formatCell(true), 'true');
  assert.equal(formatCell(null), '');
  assert.equal(formatCell(undefined), '');
  assert.equal(formatCell({ a: 1 }), '{"a":1}');
  assert.equal(formatCell(['x', 'y']), '["x","y"]');
});

test('jsonToSheets renders an AEM single sheet with union columns', () => {
  const sheets = jsonToSheets({
    total: 2,
    offset: 0,
    limit: 2,
    data: [
      { path: '/a', title: 'A' },
      { path: '/b', title: 'B', extra: 'x' },
    ],
    ':type': 'sheet',
  });
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].columns, ['path', 'title', 'extra']);
  assert.deepEqual(sheets[0].rows, [
    ['/a', 'A', ''],
    ['/b', 'B', 'x'],
  ]);
});

test('jsonToSheets splits an AEM multi-sheet by :names', () => {
  const sheets = jsonToSheets({
    ':names': ['products', 'authors'],
    ':type': 'multi-sheet',
    products: { data: [{ sku: '1' }] },
    authors: { data: [{ name: 'Ada' }] },
  });
  assert.deepEqual(sheets.map((s) => s.name), ['products', 'authors']);
  assert.deepEqual(sheets[0].columns, ['sku']);
  assert.deepEqual(sheets[1].rows, [['Ada']]);
});

test('jsonToSheets renders a bare array of objects', () => {
  const sheets = jsonToSheets([{ a: 1 }, { a: 2, b: 3 }]);
  assert.deepEqual(sheets[0].columns, ['a', 'b']);
  assert.deepEqual(sheets[0].rows, [['1', ''], ['2', '3']]);
});

test('jsonToSheets renders a plain object as a key/value table, skipping meta keys', () => {
  const sheets = jsonToSheets({ ':type': 'sheet', name: 'hero', count: 3 });
  // No `data` array → falls back to key/value; `:type` is skipped.
  assert.deepEqual(sheets[0].columns, ['key', 'value']);
  assert.deepEqual(sheets[0].rows, [['name', 'hero'], ['count', '3']]);
});

test('jsonToSheets renders an array of primitives as a value column', () => {
  const sheets = jsonToSheets({ data: ['x', 'y'] });
  assert.deepEqual(sheets[0].columns, ['value']);
  assert.deepEqual(sheets[0].rows, [['x'], ['y']]);
});
