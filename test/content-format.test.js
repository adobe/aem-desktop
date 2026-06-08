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
  formatContentForDisplay, formatJsonBody, prettyPrintHtml,
} from '../src/main/content-format.js';

test('formatJsonBody pretty-prints valid JSON', () => {
  const result = formatJsonBody('{"a":1}');
  assert.equal(result.format, 'json');
  assert.match(result.text, /"a": 1/);
});

test('prettyPrintHtml indents tags', () => {
  const result = prettyPrintHtml('<div><p>hi</p></div>');
  assert.match(result, /<div>/);
  assert.match(result, /hi/);
  assert.match(result, /<\/p>/);
});

test('formatContentForDisplay detects html and json modes', () => {
  const html = formatContentForDisplay({
    name: 'index.html',
    contentType: 'text/html',
    body: '<div></div>',
    isText: true,
  });
  assert.equal(html.mode, 'html');

  const json = formatContentForDisplay({
    name: 'config.json',
    contentType: 'application/json',
    body: '{"ok":true}',
    isText: true,
  });
  assert.equal(json.mode, 'json');
});
