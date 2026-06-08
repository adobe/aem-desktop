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
import { prettyPrintHtml } from '../src/main/pretty-print.js';

test('prettyPrintHtml indents block elements', () => {
  const input = '<div><p>hello</p></div>';
  const result = prettyPrintHtml(input);
  const lines = result.split('\n');
  assert.ok(lines[0].includes('<div>'));
  assert.ok(lines[1].includes('<p>'));
  assert.ok(lines[2].includes('hello'));
  assert.ok(lines[3].includes('</p>'));
  assert.ok(lines[4].includes('</div>'));
});

test('prettyPrintHtml handles empty input', () => {
  assert.equal(prettyPrintHtml(''), '');
  assert.equal(prettyPrintHtml(null), '');
  assert.equal(prettyPrintHtml(undefined), '');
});

test('prettyPrintHtml preserves void elements', () => {
  const input = '<div><br><img src="x.png"></div>';
  const result = prettyPrintHtml(input);
  assert.ok(result.includes('<br>'));
  assert.ok(result.includes('<img src="x.png">'));
});
