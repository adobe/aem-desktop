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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} storePath
 * @returns {Promise<string|null>}
 */
export async function loadSyncFolder(storePath) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.destFolder === 'string' && parsed.destFolder.length > 0
      ? parsed.destFolder
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} storePath
 * @param {string|null} destFolder
 */
export async function saveSyncFolder(storePath, destFolder) {
  await mkdir(dirname(storePath), { recursive: true });
  if (!destFolder) {
    await writeFile(storePath, '{}\n', 'utf8');
    return;
  }
  await writeFile(storePath, `${JSON.stringify({ destFolder }, null, 2)}\n`, 'utf8');
}
