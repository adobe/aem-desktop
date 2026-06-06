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
import { mkdir, writeFile, rm } from 'node:fs/promises';
import {
  isBinaryExtension, syncPaths, manifestPath, checkSyncStatus,
} from '../src/main/da-sync.js';

test('isBinaryExtension returns false for text extensions', () => {
  for (const ext of ['html', 'json', 'css', 'js', 'xml', 'md', 'svg', 'csv']) {
    assert.equal(isBinaryExtension(ext), false, `${ext} should be text`);
  }
});

test('isBinaryExtension returns true for binary extensions', () => {
  for (const ext of ['png', 'jpg', 'mp4', 'pdf', 'zip', 'woff2']) {
    assert.equal(isBinaryExtension(ext), true, `${ext} should be binary`);
  }
});

test('isBinaryExtension returns true for undefined/empty', () => {
  assert.equal(isBinaryExtension(undefined), true);
  assert.equal(isBinaryExtension(''), true);
});

test('syncPaths builds working and original paths', () => {
  const result = syncPaths('/dest', 'myorg', 'myrepo', '/blog/post.html');
  assert.equal(result.workingPath, join('/dest', 'myorg', 'myrepo', 'blog', 'post.html'));
  assert.equal(result.originalPath, join('/dest', 'myorg', 'myrepo', '.aem', 'blog', 'post.html'));
});

test('syncPaths handles root-level files', () => {
  const result = syncPaths('/dest', 'org', 'repo', '/index.html');
  assert.equal(result.workingPath, join('/dest', 'org', 'repo', 'index.html'));
  assert.equal(result.originalPath, join('/dest', 'org', 'repo', '.aem', 'index.html'));
});

test('manifestPath returns path inside .aem', () => {
  const result = manifestPath('/dest', 'org', 'repo');
  assert.equal(result, join('/dest', 'org', 'repo', '.aem', 'manifest.json'));
});

test('checkSyncStatus reports all files as new when no manifest exists', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-new`);
  try {
    const result = await checkSyncStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      remoteFiles: [
        { daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' },
        { daPath: '/b.html', lastModified: '2026-01-01T00:00:00Z' },
      ],
    });
    assert.equal(result.newCount, 2);
    assert.equal(result.outdatedCount, 0);
    assert.equal(result.conflictCount, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkSyncStatus detects outdated files from changed lastModified', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-upd`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' }],
    }));
    await writeFile(join(workDir, 'a.html'), 'original');
    await writeFile(join(aemDir, 'a.html'), 'original');

    const result = await checkSyncStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      remoteFiles: [
        { daPath: '/a.html', lastModified: '2026-02-01T00:00:00Z' },
      ],
    });
    assert.equal(result.outdatedCount, 1);
    assert.equal(result.conflictCount, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkSyncStatus detects conflicts when working file differs from original', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-conf`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' }],
    }));
    await writeFile(join(workDir, 'a.html'), 'locally modified');
    await writeFile(join(aemDir, 'a.html'), 'original');

    const result = await checkSyncStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      remoteFiles: [
        { daPath: '/a.html', lastModified: '2026-02-01T00:00:00Z' },
      ],
    });
    assert.equal(result.conflictCount, 1);
    assert.deepEqual(result.conflicts, ['/a.html']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkSyncStatus treats missing manifest lastModified as outdated', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-nots`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/a.html' }],
    }));
    await writeFile(join(workDir, 'a.html'), 'original');
    await writeFile(join(aemDir, 'a.html'), 'original');

    const result = await checkSyncStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      remoteFiles: [
        { daPath: '/a.html', lastModified: '2026-02-01T00:00:00Z' },
      ],
    });
    assert.equal(result.outdatedCount, 1);
    assert.deepEqual(result.outdated, ['/a.html']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
