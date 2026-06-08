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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { loadSyncFolder, saveSyncFolder } from '../src/main/sync-folder-store.js';

test('loadSyncFolder returns null when store is missing', async () => {
  const storePath = join(tmpdir(), `sync-folder-missing-${Date.now()}.json`);
  const folder = await loadSyncFolder(storePath);
  assert.equal(folder, null);
});

test('saveSyncFolder persists and loadSyncFolder reads back', async () => {
  const storePath = join(tmpdir(), `sync-folder-${Date.now()}.json`);
  try {
    await saveSyncFolder(storePath, '/Users/me/Sync');
    assert.equal(await loadSyncFolder(storePath), '/Users/me/Sync');
  } finally {
    await rm(storePath, { force: true });
  }
});

test('saveSyncFolder clears stored path when null', async () => {
  const storePath = join(tmpdir(), `sync-folder-clear-${Date.now()}.json`);
  try {
    await saveSyncFolder(storePath, '/Users/me/Sync');
    await saveSyncFolder(storePath, null);
    assert.equal(await loadSyncFolder(storePath), null);
  } finally {
    await rm(storePath, { force: true });
  }
});
