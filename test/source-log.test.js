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
import { isInternalSourcePath, extractSourceChanges } from '../src/main/source-log.js';

test('isInternalSourcePath flags dot-segment paths (e.g. .versions)', () => {
  assert.equal(isInternalSourcePath('/index.html/.versions'), true);
  assert.equal(isInternalSourcePath('/.helix/config.json'), true);
  assert.equal(isInternalSourcePath('/index.html'), false);
  assert.equal(isInternalSourcePath('/en/blog/post.html'), false);
});

test('extractSourceChanges keeps source POST/PUT as updates and DELETE as removals', () => {
  const changes = extractSourceChanges([
    {
      route: 'source', method: 'POST', path: '/a.html', status: 201, timestamp: 1,
    },
    {
      route: 'source', method: 'PUT', path: '/b.html', status: 200, timestamp: 2,
    },
    {
      route: 'source', method: 'DELETE', path: '/c.html', status: 200, timestamp: 3,
    },
  ], 'main');
  assert.equal(changes.get('/a.html').deleted, false);
  assert.equal(changes.get('/b.html').deleted, false);
  assert.equal(changes.get('/c.html').deleted, true);
});

test('extractSourceChanges filters non-source routes, other refs, failures, internal paths', () => {
  const changes = extractSourceChanges([
    {
      route: 'preview', method: 'POST', path: '/a.html', status: 200, timestamp: 1,
    },
    {
      route: 'live', method: 'POST', path: '/a.html', status: 200, timestamp: 1,
    },
    {
      route: 'source', method: 'POST', path: '/branch.html', status: 201, timestamp: 1, ref: 'dev',
    },
    {
      route: 'source', method: 'POST', path: '/failed.html', status: 500, timestamp: 1,
    },
    {
      route: 'source', method: 'POST', path: '/x.html/.versions', status: 201, timestamp: 1,
    },
    {
      route: 'source', method: 'HEAD', path: '/head.html', status: 200, timestamp: 1,
    },
  ], 'main');
  assert.equal(changes.size, 0);
});

test('extractSourceChanges takes the latest entry per path', () => {
  const changes = extractSourceChanges([
    {
      route: 'source', method: 'POST', path: '/p.html', status: 201, timestamp: 10,
    },
    {
      route: 'source', method: 'DELETE', path: '/p.html', status: 200, timestamp: 30,
    },
    {
      route: 'source', method: 'PUT', path: '/p.html', status: 200, timestamp: 20,
    },
  ], 'main');
  assert.equal(changes.size, 1);
  assert.equal(changes.get('/p.html').deleted, true, 'latest (delete@30) wins');
  assert.equal(changes.get('/p.html').timestamp, 30);
});

test('extractSourceChanges keeps entries when no ref filter is given', () => {
  const changes = extractSourceChanges([
    {
      route: 'source', method: 'POST', path: '/a.html', status: 201, timestamp: 1, ref: 'dev',
    },
  ]);
  assert.equal(changes.has('/a.html'), true);
});
