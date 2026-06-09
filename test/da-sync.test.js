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
  collectSyncedFoldersFromAem, collectFolder, checkLocalSyncBadges,
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

test('collectSyncedFoldersFromAem lists directories under .aem', async () => {
  const dest = join(tmpdir(), `aem-sync-folders-${Date.now()}`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  try {
    await mkdir(join(aemDir, 'blog', 'posts'), { recursive: true });
    await writeFile(join(aemDir, 'blog', 'posts', 'a.html'), 'content');
    await writeFile(join(aemDir, 'manifest.json'), '{}');

    const folders = await collectSyncedFoldersFromAem(dest, 'o', 'r');
    assert.deepEqual(folders, ['/blog', '/blog/posts']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkSyncStatus includes syncedFolders from .aem layout', async () => {
  const dest = join(tmpdir(), `aem-sync-folder-badge-${Date.now()}`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(join(aemDir, 'docs'), { recursive: true });
    await mkdir(join(workDir, 'docs'), { recursive: true });
    await writeFile(join(aemDir, 'docs', 'page.html'), 'original');
    await writeFile(join(workDir, 'docs', 'page.html'), 'original');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/docs/page.html', lastModified: '2026-01-01T00:00:00Z' }],
    }));

    const result = await checkSyncStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      remoteFiles: [
        { daPath: '/docs/page.html', lastModified: '2026-01-01T00:00:00Z' },
      ],
    });
    assert.deepEqual(result.syncedFolders, ['/docs']);
    assert.equal(result.unchangedCount, 1);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('collectFolder lists nested files with parallel folder requests', async () => {
  const listings = {
    '/': [
      { path: '/blog', ext: undefined },
      { path: '/assets', ext: undefined },
    ],
    '/blog': [
      { path: '/blog/post.html', ext: 'html', lastModified: '2026-01-01T00:00:00Z' },
    ],
    '/assets': [
      { path: '/assets/logo.png', ext: 'png', lastModified: '2026-01-01T00:00:00Z' },
    ],
  };
  let peakConcurrent = 0;
  let inFlight = 0;
  const client = {
    list: async (_org, _repo, folderPath) => {
      inFlight += 1;
      peakConcurrent = Math.max(peakConcurrent, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return listings[folderPath] || [];
    },
  };

  const progress = [];
  const files = await collectFolder(
    client,
    'org',
    'repo',
    '/',
    true,
    undefined,
    ({ discovered }) => progress.push(discovered),
  );

  assert.equal(files.length, 2);
  assert.deepEqual(
    files.map((f) => f.daPath).sort(),
    ['/assets/logo.png', '/blog/post.html'],
  );
  assert.equal(peakConcurrent, 2, 'subfolders should be listed in parallel');
  assert.deepEqual(progress, [1, 2]);
});

test('collectFolder skips binaries when includeBinaries is false', async () => {
  const client = {
    list: async () => ([
      { path: '/index.html', ext: 'html' },
      { path: '/photo.png', ext: 'png' },
    ]),
  };

  const files = await collectFolder(client, 'org', 'repo', '/', false);
  assert.deepEqual(files.map((f) => f.daPath), ['/index.html']);
});

test('checkLocalSyncBadges marks synced folders from .aem layout', async () => {
  const dest = join(tmpdir(), `aem-local-badges-${Date.now()}`);
  try {
    await mkdir(join(dest, 'o', 'r', '.aem', 'docs'), { recursive: true });

    const { syncedFolders, badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
    });

    assert.deepEqual(syncedFolders, ['/docs']);
    assert.equal(badges['/docs'], 'synced');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkLocalSyncBadges classifies listed files from manifest', async () => {
  const dest = join(tmpdir(), `aem-local-file-badges-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(workDir, 'page.html'), 'edited');
    await writeFile(join(aemDir, 'page.html'), 'original');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/page.html', lastModified: '2026-01-01T00:00:00Z' }],
    }));

    const { badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      folderPath: '/',
      items: [{
        daPath: '/page.html',
        isFolder: false,
        lastModified: '2026-01-01T00:00:00Z',
      }],
    });

    assert.equal(badges['/page.html'], 'modified');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
