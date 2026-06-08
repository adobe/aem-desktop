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
import {
  mkdir, writeFile, rm, copyFile,
} from 'node:fs/promises';
import {
  checkPushStatus, syncPaths, manifestPath,
} from '../src/main/da-sync.js';

test('checkPushStatus reports remaining modified files after one is pushed', async () => {
  const dest = join(tmpdir(), `aem-push-test-${Date.now()}`);
  const org = 'o';
  const repo = 'r';
  const aemDir = join(dest, org, repo, '.aem');
  const workDir = join(dest, org, repo);
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(manifestPath(dest, org, repo), JSON.stringify({
      org,
      repo,
      files: [
        { daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' },
        { daPath: '/b.html', lastModified: '2026-01-01T00:00:00Z' },
      ],
    }));
    await writeFile(join(aemDir, 'a.html'), 'original a');
    await writeFile(join(aemDir, 'b.html'), 'original b');
    await writeFile(join(workDir, 'a.html'), 'modified a');
    await writeFile(join(workDir, 'b.html'), 'modified b');

    let status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.deepEqual(status.modified.sort(), ['/a.html', '/b.html']);

    const aPaths = syncPaths(dest, org, repo, '/a.html');
    await copyFile(aPaths.workingPath, aPaths.originalPath);

    status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.deepEqual(status.modified, ['/b.html']);
    assert.equal(status.localNew.length, 0);
    assert.equal(status.deleted.length, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkPushStatus reports remaining localNew files after one is pushed', async () => {
  const dest = join(tmpdir(), `aem-push-new-${Date.now()}`);
  const org = 'o';
  const repo = 'r';
  const aemDir = join(dest, org, repo, '.aem');
  const workDir = join(dest, org, repo);
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(manifestPath(dest, org, repo), JSON.stringify({
      org,
      repo,
      files: [],
    }));
    await writeFile(join(workDir, 'a.html'), 'new a');
    await writeFile(join(workDir, 'b.html'), 'new b');

    let status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.deepEqual(status.localNew.sort(), ['/a.html', '/b.html']);

    await mkdir(aemDir, { recursive: true });
    await copyFile(join(workDir, 'a.html'), join(aemDir, 'a.html'));
    await writeFile(manifestPath(dest, org, repo), JSON.stringify({
      org,
      repo,
      files: [{ daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' }],
    }));

    status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.deepEqual(status.localNew, ['/b.html']);
    assert.equal(status.modified.length, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
