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
  entryDisplayLabel, getIconByExtension,
} from '../src/renderer/entry-utils.js';

test('entryDisplayLabel omits extension for html only', () => {
  assert.equal(entryDisplayLabel({ name: 'index', ext: 'html' }), 'index');
  assert.equal(entryDisplayLabel({ name: 'config', ext: 'json' }), 'config.json');
});

test('entryDisplayLabel includes extension for other file types', () => {
  assert.equal(entryDisplayLabel({ name: 'styles', ext: 'css' }), 'styles.css');
  assert.equal(entryDisplayLabel({ name: 'photo', ext: 'png' }), 'photo.png');
});

test('entryDisplayLabel shows folder name only', () => {
  assert.equal(entryDisplayLabel({ name: 'blog', isFolder: true }), 'blog');
});

test('getIconByExtension maps types like da-nx', () => {
  assert.equal(getIconByExtension('html'), 'fileText');
  assert.equal(getIconByExtension('json'), 'table');
  assert.equal(getIconByExtension('png'), 'image');
  assert.equal(getIconByExtension('css'), 'fileText');
});
