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
  API_BACKEND_DA_LIVE,
  buildPostUploadRequest,
  DA_UNAUTHORIZED_MESSAGE,
  isDaUnauthorizedError,
  normalizeDaPath,
  toApiRelativePath,
} from '../src/main/content-api-shared.js';

test('normalizeDaPath and toApiRelativePath', () => {
  assert.equal(normalizeDaPath('/blog/'), '/blog');
  assert.equal(normalizeDaPath('blog'), '/blog');
  assert.equal(toApiRelativePath('/blog/post.html'), 'blog/post.html');
  assert.equal(toApiRelativePath('/'), '');
});

test('buildPostUploadRequest sets filename from daPath for da.live', () => {
  const { body } = buildPostUploadRequest(
    API_BACKEND_DA_LIVE,
    Buffer.from('x'),
    'text/html',
    '/blog/post.html',
  );
  assert.ok(body instanceof FormData);
});

test('isDaUnauthorizedError detects API and IPC-wrapped unauthorized errors', () => {
  assert.equal(isDaUnauthorizedError(new Error(DA_UNAUTHORIZED_MESSAGE)), true);
  assert.equal(
    isDaUnauthorizedError(new Error("Error invoking remote method 'da:list': Error: Unauthorized: invalid or expired token")),
    true,
  );
  assert.equal(isDaUnauthorizedError(new Error('List failed for /')), false);
});
