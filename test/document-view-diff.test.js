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
import { diffDocumentHtml, inlineHtmlDiff } from '../src/main/document-view-diff.js';

test('diffDocumentHtml reports identical documents as unchanged', () => {
  const html = `<div>
  <h1>Title</h1>
  <div class="hero">
    <div><div>Left</div><div>Right</div></div>
  </div>
</div>`;

  const diff = diffDocumentHtml(html, html);

  assert.equal(diff.changed, false);
  assert.ok(diff.items.length > 0);
  assert.ok(diff.items.every((item) => item.change === 'unchanged'));
});

test('diffDocumentHtml marks edited text as modified with inline ins/del', () => {
  const oldHtml = '<div><p>Hello old world</p></div>';
  const newHtml = '<div><p>Hello new world</p></div>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  assert.equal(diff.changed, true);
  const modified = diff.items.find((item) => item.change === 'modified');
  assert.equal(modified.kind, 'content');
  assert.match(modified.html, /<del class="da-diff-del">old<\/del>/);
  assert.match(modified.html, /<ins class="da-diff-ins">new<\/ins>/);
});

test('diffDocumentHtml marks an added block', () => {
  const oldHtml = '<main><div><h1>Title</h1></div></main>';
  const newHtml = `<main><div>
  <h1>Title</h1>
  <div class="hero">
    <div><div>Left</div><div>Right</div></div>
  </div>
</div></main>`;

  const diff = diffDocumentHtml(oldHtml, newHtml);

  assert.equal(diff.changed, true);
  const added = diff.items.find((item) => item.change === 'added');
  assert.equal(added.kind, 'table');
  assert.equal(added.name, 'hero');
});

test('diffDocumentHtml marks a removed block', () => {
  const oldHtml = `<main><div>
  <h1>Title</h1>
  <div class="hero">
    <div><div>Left</div><div>Right</div></div>
  </div>
</div></main>`;
  const newHtml = '<main><div><h1>Title</h1></div></main>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  assert.equal(diff.changed, true);
  const removed = diff.items.find((item) => item.change === 'removed');
  assert.equal(removed.kind, 'table');
  assert.equal(removed.name, 'hero');
});

test('diffDocumentHtml marks an added section break', () => {
  const oldHtml = '<div><p>One</p><p>Two</p></div>';
  const newHtml = '<div><p>One</p></div>\n<hr>\n<div><p>Two</p></div>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  assert.equal(diff.changed, true);
  const breakItem = diff.items.find((item) => item.kind === 'break');
  assert.equal(breakItem.change, 'added');
});

test('diffDocumentHtml marks a removed section break', () => {
  const oldHtml = '<div><p>One</p></div>\n<hr>\n<div><p>Two</p></div>';
  const newHtml = '<div><p>One</p><p>Two</p></div>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  assert.equal(diff.changed, true);
  const breakItem = diff.items.find((item) => item.kind === 'break');
  assert.equal(breakItem.change, 'removed');
});

test('diffDocumentHtml keeps an unchanged section break unchanged', () => {
  const oldHtml = '<div><p>One</p></div>\n<hr>\n<div><p>Two</p></div>';
  const newHtml = '<div><p>One</p></div>\n<hr>\n<div><p>Two changed</p></div>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  const breakItem = diff.items.find((item) => item.kind === 'break');
  assert.equal(breakItem.change, 'unchanged');
});

test('diffDocumentHtml diffs table cells row by row', () => {
  const oldHtml = `<div class="hero">
  <div><div>Title</div><div>Old body</div></div>
  <div><div>Keep</div><div>Same</div></div>
</div>`;
  const newHtml = `<div class="hero">
  <div><div>Title</div><div>New body</div></div>
  <div><div>Keep</div><div>Same</div></div>
</div>`;

  const diff = diffDocumentHtml(oldHtml, newHtml);

  const table = diff.items.find((item) => item.kind === 'table');
  assert.equal(table.change, 'modified');
  assert.equal(table.name, 'hero');
  assert.equal(table.rows[0].change, 'modified');
  assert.match(table.rows[0].cells[1], /<del class="da-diff-del">Old<\/del>/);
  assert.match(table.rows[0].cells[1], /<ins class="da-diff-ins">New<\/ins>/);
  assert.equal(table.rows[1].change, 'unchanged');
});

test('diffDocumentHtml marks added and removed table rows', () => {
  const oldHtml = `<div class="cards">
  <div><div>One</div><div>1</div></div>
  <div><div>Two</div><div>2</div></div>
</div>`;
  const newHtml = `<div class="cards">
  <div><div>One</div><div>1</div></div>
  <div><div>Three</div><div>3</div></div>
  <div><div>Two</div><div>2</div></div>
</div>`;

  const diff = diffDocumentHtml(oldHtml, newHtml);

  const table = diff.items.find((item) => item.kind === 'table');
  assert.equal(table.change, 'modified');
  const addedRow = table.rows.find((row) => row.change === 'added');
  assert.deepEqual(addedRow.cells, ['Three', '3']);
});

test('diffDocumentHtml treats a renamed block as removed plus added', () => {
  const oldHtml = '<main><div><div class="hero"><div><div>Body</div></div></div></div></main>';
  const newHtml = '<main><div><div class="banner"><div><div>Body</div></div></div></div></main>';

  const diff = diffDocumentHtml(oldHtml, newHtml);

  const removed = diff.items.find((item) => item.change === 'removed');
  const added = diff.items.find((item) => item.change === 'added');
  assert.equal(removed.name, 'hero');
  assert.equal(added.name, 'banner');
});

test('diffDocumentHtml marks everything added for a new document', () => {
  const diff = diffDocumentHtml('', '<div><h1>Title</h1></div>');

  assert.equal(diff.changed, true);
  assert.ok(diff.items.length > 0);
  assert.ok(diff.items.every((item) => item.change === 'added'));
});

test('diffDocumentHtml marks everything removed for a deleted document', () => {
  const diff = diffDocumentHtml('<div><h1>Title</h1></div>', '');

  assert.equal(diff.changed, true);
  assert.ok(diff.items.length > 0);
  assert.ok(diff.items.every((item) => item.change === 'removed'));
});

test('inlineHtmlDiff coalesces a rewritten sentence into one del and one ins', () => {
  const oldHtml = '<p>Unbelievable but this seems to be an original, this must have a name</p>';
  const newHtml = '<p>An Independent Drinker original, a stripped-down two-ingredient sipper '
    + 'of whiskey and Aperol. Simple enough to make the same way.</p>';

  const html = inlineHtmlDiff(oldHtml, newHtml);

  assert.equal((html.match(/<del/g) || []).length, 1);
  assert.equal((html.match(/<ins/g) || []).length, 1);
  const del = html.match(/<del class="da-diff-del">([^]*?)<\/del>/)[1];
  const ins = html.match(/<ins class="da-diff-ins">([^]*?)<\/ins>/)[1];
  assert.equal(del, 'Unbelievable but this seems to be an original, this must have a name');
  assert.equal(
    ins,
    'An Independent Drinker original, a stripped-down two-ingredient sipper '
      + 'of whiskey and Aperol. Simple enough to make the same way.',
  );
});

test('inlineHtmlDiff keeps single-word edits minimal', () => {
  const html = inlineHtmlDiff(
    '<p>The quick brown fox jumps</p>',
    '<p>The quick red fox jumps</p>',
  );

  assert.equal(html, '<p>The quick <del class="da-diff-del">brown</del>'
    + '<ins class="da-diff-ins">red</ins> fox jumps</p>');
});

test('inlineHtmlDiff does not strike anchors between pure insertions', () => {
  const html = inlineHtmlDiff(
    '<p>keep</p>',
    '<p>added keep also</p>',
  );

  assert.ok(!html.includes('<del'));
  assert.match(html, /(^|>)keep|keep(<|$)/);
});

test('inlineHtmlDiff keeps deleted images visible inside del', () => {
  const oldHtml = '<p>Text <img src="/a.jpg"> more</p>';
  const newHtml = '<p>Text more</p>';

  const html = inlineHtmlDiff(oldHtml, newHtml);

  assert.match(html, /<del class="da-diff-del"><img src="\/a\.jpg"><\/del>/);
});

test('inlineHtmlDiff drops deleted structural tags to stay well-formed', () => {
  const oldHtml = '<p>One</p><p>Two</p>';
  const newHtml = '<p>One Two</p>';

  const html = inlineHtmlDiff(oldHtml, newHtml);

  assert.equal((html.match(/<p>/g) || []).length, 1);
  assert.equal((html.match(/<\/p>/g) || []).length, 1);
});
