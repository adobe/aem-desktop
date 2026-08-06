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
import { formatRelativeTime } from '../src/renderer/relative-time.js';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('formatRelativeTime returns empty for missing/invalid input', () => {
  assert.equal(formatRelativeTime(null, NOW), '');
  assert.equal(formatRelativeTime(undefined, NOW), '');
  assert.equal(formatRelativeTime('not a date', NOW), '');
});

test('formatRelativeTime buckets recent times', () => {
  assert.equal(formatRelativeTime(ago(5 * 1000), NOW), 'just now');
  assert.equal(formatRelativeTime(ago(5 * 60 * 1000), NOW), '5 min ago');
  assert.equal(formatRelativeTime(ago(3 * 60 * 60 * 1000), NOW), '3 hr ago');
  assert.equal(formatRelativeTime(ago(24 * 60 * 60 * 1000), NOW), '1 day ago');
  assert.equal(formatRelativeTime(ago(3 * 24 * 60 * 60 * 1000), NOW), '3 days ago');
});

test('formatRelativeTime falls back to the date beyond a week', () => {
  assert.equal(formatRelativeTime('2026-07-01T09:30:00.000Z', NOW), '2026-07-01');
});

test('formatRelativeTime clamps future timestamps to just now', () => {
  assert.equal(formatRelativeTime(ago(-5000), NOW), 'just now');
});
