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
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearStoredToken,
  getAuthStatus,
  isTokenExpired,
  logout,
  saveToken,
} from '../src/main/da-auth.js';

test('isTokenExpired treats missing token as expired', () => {
  assert.equal(isTokenExpired(null), true);
  assert.equal(isTokenExpired({ access_token: 'abc', expires_at: Date.now() - 1000 }), true);
  assert.equal(isTokenExpired({ access_token: 'abc', expires_at: Date.now() + 3600_000 }), false);
});

test('logout clears stored token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-auth-'));
  const tokenPath = join(dir, '.da-token.json');
  await saveToken(tokenPath, {
    access_token: 'test-token',
    expires_at: Date.now() + 3600_000,
  });

  const status = await logout(tokenPath);
  assert.equal(status.authenticated, false);
  await assert.rejects(() => readFile(tokenPath, 'utf8'));
});

test('clearStoredToken ignores missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-auth-'));
  const tokenPath = join(dir, 'missing.json');
  await clearStoredToken(tokenPath);
  const status = await getAuthStatus(tokenPath);
  assert.equal(status.authenticated, false);
});

test('getAuthStatus reports authenticated for valid token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-auth-'));
  const tokenPath = join(dir, '.da-token.json');
  const expiresAt = Date.now() + 3600_000;
  await writeFile(tokenPath, JSON.stringify({
    access_token: 'test-token',
    expires_at: expiresAt,
  }));

  const status = await getAuthStatus(tokenPath);
  assert.equal(status.authenticated, true);
  assert.equal(status.expiresAt, expiresAt);
});
