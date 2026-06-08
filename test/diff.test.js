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
import { myersDiff, buildHunks } from '../src/main/diff.js';

test('myersDiff returns empty for identical inputs', () => {
  const edits = myersDiff(['a', 'b', 'c'], ['a', 'b', 'c']);
  assert.ok(edits.every((e) => e.type === 'equal'));
  assert.equal(edits.length, 3);
});

test('myersDiff detects insertions', () => {
  const edits = myersDiff(['a', 'c'], ['a', 'b', 'c']);
  const inserts = edits.filter((e) => e.type === 'insert');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].line, 'b');
});

test('myersDiff detects deletions', () => {
  const edits = myersDiff(['a', 'b', 'c'], ['a', 'c']);
  const deletes = edits.filter((e) => e.type === 'delete');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].line, 'b');
});

test('myersDiff handles empty old', () => {
  const edits = myersDiff([], ['a', 'b']);
  assert.equal(edits.length, 2);
  assert.ok(edits.every((e) => e.type === 'insert'));
});

test('myersDiff handles empty new', () => {
  const edits = myersDiff(['a', 'b'], []);
  assert.equal(edits.length, 2);
  assert.ok(edits.every((e) => e.type === 'delete'));
});

test('buildHunks groups changes with context', () => {
  const old = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const nw = ['1', '2', 'X', '4', '5', '6', '7', '8'];
  const edits = myersDiff(old, nw);
  const hunks = buildHunks(edits);
  assert.equal(hunks.length, 1);
  const addLines = hunks[0].lines.filter((l) => l.type === 'add');
  const delLines = hunks[0].lines.filter((l) => l.type === 'delete');
  assert.equal(addLines.length, 1);
  assert.equal(delLines.length, 1);
  assert.equal(addLines[0].content, 'X');
  assert.equal(delLines[0].content, '3');
});

test('buildHunks returns empty for no changes', () => {
  const edits = myersDiff(['a', 'b'], ['a', 'b']);
  const hunks = buildHunks(edits);
  assert.equal(hunks.length, 0);
});
