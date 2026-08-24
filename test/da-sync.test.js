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
  mkdir, writeFile, rm, readFile, stat,
} from 'node:fs/promises';
import {
  isBinaryExtension, isPushableLocalNewFile, syncPaths, manifestPath, checkSyncStatus,
  collectSyncedFoldersFromAem, collectFolder, checkLocalSyncBadges,
  evaluatePullStatus, runPull, runSync, runPush, checkPushStatus, checkPullStatus,
  hasLocalContent, localContentSummary, deleteLocalContent,
  pruneSelectionForListing, computeSyncSummary, readCachedSyncSummary, statusCachePath,
  touchPullCheckedAt,
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

test('checkLocalSyncBadges surfaces local-only folders as new', async () => {
  const dest = join(tmpdir(), `aem-local-folder-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  try {
    // A brand-new local folder that exists only on disk (not in the remote
    // listing), with a file inside it.
    await mkdir(join(workDir, 'drafts'), { recursive: true });
    await writeFile(join(workDir, 'drafts', 'post.html'), 'draft');

    const { localFolders, badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      folderPath: '/',
      items: [], // remote listing has no such folder
    });

    assert.deepEqual(localFolders, ['/drafts']);
    assert.equal(badges['/drafts'], 'new');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkLocalSyncBadges does not duplicate folders present in the remote listing', async () => {
  const dest = join(tmpdir(), `aem-local-folder-dup-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(join(workDir, 'docs'), { recursive: true });

    const { localFolders, badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      folderPath: '/',
      items: [{ daPath: '/docs', isFolder: true }], // already listed remotely
    });

    assert.deepEqual(localFolders, []);
    assert.equal(badges['/docs'], undefined);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkLocalSyncBadges lists local-only child folders of a subfolder', async () => {
  const dest = join(tmpdir(), `aem-local-folder-nested-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  try {
    await mkdir(join(workDir, 'blog', 'drafts'), { recursive: true });

    const { localFolders } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      folderPath: '/blog',
      items: [],
    });

    assert.deepEqual(localFolders, ['/blog/drafts']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('evaluatePullStatus finds outdated and conflict files', async () => {
  const dest = join(tmpdir(), `aem-pull-test-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(workDir, 'a.html'), 'local edit');
    await writeFile(join(aemDir, 'a.html'), 'original a');
    await writeFile(join(workDir, 'b.html'), 'original b');
    await writeFile(join(aemDir, 'b.html'), 'original b');
    const manifestFiles = [
      { daPath: '/a.html', lastModified: '2026-01-01T00:00:00Z' },
      { daPath: '/b.html', lastModified: '2026-01-01T00:00:00Z' },
    ];
    const remoteMeta = new Map([
      ['/a.html', { lastModified: '2026-02-01T00:00:00Z', ext: 'html' }],
      ['/b.html', { lastModified: '2026-02-01T00:00:00Z', ext: 'html' }],
    ]);

    const result = await evaluatePullStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      manifestFiles,
      remoteMeta,
    });

    assert.deepEqual(result.outdated, ['/b.html']);
    assert.deepEqual(result.conflicts, ['/a.html']);
    assert.equal(result.files.length, 2);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('evaluatePullStatus detects files deleted on the remote', async () => {
  const dest = join(tmpdir(), `aem-pull-deleted-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(workDir, 'gone.html'), 'original');
    await writeFile(join(aemDir, 'gone.html'), 'original');
    await writeFile(join(workDir, 'edited.html'), 'local edit');
    await writeFile(join(aemDir, 'edited.html'), 'original');
    const manifestFiles = [
      { daPath: '/gone.html', lastModified: '2026-01-01T00:00:00Z' },
      { daPath: '/edited.html', lastModified: '2026-01-01T00:00:00Z' },
      { daPath: '/still.html', lastModified: '2026-01-01T00:00:00Z' },
    ];
    const remoteMeta = new Map([
      ['/still.html', { lastModified: '2026-01-01T00:00:00Z', ext: 'html' }],
    ]);

    const result = await evaluatePullStatus({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      manifestFiles,
      remoteMeta,
    });

    assert.deepEqual(result.deletedRemotely, ['/gone.html']);
    assert.deepEqual(result.deletedConflicts, ['/edited.html']);
    assert.equal(result.deletions.length, 2);
    assert.equal(result.files.length, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('runPull removes locally synced files deleted on the remote', async () => {
  const dest = join(tmpdir(), `aem-pull-run-delete-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  const client = { downloadRaw: async () => null };
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(workDir, 'gone.html'), 'original');
    await writeFile(join(aemDir, 'gone.html'), 'original');
    await writeFile(join(workDir, 'stay.html'), 'unchanged');
    await writeFile(join(aemDir, 'stay.html'), 'unchanged');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o',
      repo: 'r',
      files: [
        { daPath: '/gone.html', lastModified: '2026-01-01T00:00:00Z' },
        { daPath: '/stay.html', lastModified: '2026-01-01T00:00:00Z' },
      ],
    }));

    const progress = [];
    const result = await runPull({
      client,
      org: 'o',
      repo: 'r',
      destRoot: dest,
      files: [],
      deletions: ['/gone.html'],
      onProgress: (data) => progress.push(data),
    });

    assert.equal(result.pulled, 0);
    assert.equal(result.deleted, 1);
    await assert.rejects(stat(join(workDir, 'gone.html')));
    await assert.rejects(stat(join(aemDir, 'gone.html')));
    await stat(join(workDir, 'stay.html'));

    const manifest = JSON.parse(await readFile(join(aemDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.map((f) => f.daPath), ['/stay.html']);
    assert.equal(progress.at(-1)?.phase, 'done');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('hasLocalContent reflects presence of a synced directory', async () => {
  assert.equal(await hasLocalContent({ destRoot: null, org: 'o', repo: 'r' }), false);

  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-has`);
  try {
    assert.equal(await hasLocalContent({ destRoot: dest, org: 'o', repo: 'r' }), false);
    await mkdir(join(dest, 'o', 'r', '.aem'), { recursive: true });
    await writeFile(join(dest, 'o', 'r', '.aem', 'manifest.json'), '{"files":[]}');
    assert.equal(await hasLocalContent({ destRoot: dest, org: 'o', repo: 'r' }), true);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('localContentSummary counts uncommitted local changes', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-summary`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  const workDir = join(dest, 'o', 'r');
  try {
    // No content synced yet.
    let summary = await localContentSummary({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(summary, { hasContent: false, changeCount: 0 });

    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      files: [{ daPath: '/a.html' }, { daPath: '/b.html' }],
    }));
    // a.html modified locally, b.html unchanged, c.html is new/local-only.
    await writeFile(join(aemDir, 'a.html'), 'original');
    await writeFile(join(workDir, 'a.html'), 'changed');
    await writeFile(join(aemDir, 'b.html'), 'same');
    await writeFile(join(workDir, 'b.html'), 'same');
    await writeFile(join(workDir, 'c.html'), 'brand new');

    summary = await localContentSummary({ destRoot: dest, org: 'o', repo: 'r' });
    assert.equal(summary.hasContent, true);
    assert.equal(summary.changeCount, 2); // modified a.html + new c.html
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('deleteLocalContent removes the connection sync directory only', async () => {
  const dest = join(tmpdir(), `aem-sync-test-${Date.now()}-del`);
  try {
    await mkdir(join(dest, 'o', 'r', '.aem'), { recursive: true });
    await writeFile(join(dest, 'o', 'r', 'index.html'), 'hi');
    // A second connection under the same sync folder must survive.
    await mkdir(join(dest, 'o', 'other'), { recursive: true });
    await writeFile(join(dest, 'o', 'other', 'keep.html'), 'keep');

    await deleteLocalContent({ destRoot: dest, org: 'o', repo: 'r' });

    await assert.rejects(stat(join(dest, 'o', 'r')));
    await stat(join(dest, 'o', 'other', 'keep.html'));

    // Deleting again is a no-op, not an error.
    await deleteLocalContent({ destRoot: dest, org: 'o', repo: 'r' });
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('pruneSelectionForListing drops items nested under a selected folder', () => {
  const items = [
    { daPath: '/products', isFolder: true },
    { daPath: '/products/shoes', isFolder: true },
    { daPath: '/products/shoes/a.html', isFolder: false },
    { daPath: '/about.html', isFolder: false },
  ];
  const pruned = pruneSelectionForListing(items);
  assert.deepEqual(pruned.map((i) => i.daPath), ['/products', '/about.html']);
});

test('pruneSelectionForListing keeps sibling folders and removes duplicates', () => {
  const items = [
    { daPath: '/blog', isFolder: true },
    { daPath: '/news', isFolder: true },
    { daPath: '/blog', isFolder: true },
  ];
  const pruned = pruneSelectionForListing(items);
  assert.deepEqual(pruned.map((i) => i.daPath), ['/blog', '/news']);
});

test('pruneSelectionForListing does not treat name-prefix siblings as nested', () => {
  // '/foo-bar' is not under '/foo' — only '/foo/…' is.
  const items = [
    { daPath: '/foo', isFolder: true },
    { daPath: '/foo-bar', isFolder: true },
    { daPath: '/foo/child.html', isFolder: false },
  ];
  const pruned = pruneSelectionForListing(items);
  assert.deepEqual(pruned.map((i) => i.daPath), ['/foo', '/foo-bar']);
});

test('pruneSelectionForListing collapses everything under a selected root', () => {
  const items = [
    { daPath: '/', isFolder: true },
    { daPath: '/a', isFolder: true },
    { daPath: '/a/b.html', isFolder: false },
  ];
  const pruned = pruneSelectionForListing(items);
  assert.deepEqual(pruned.map((i) => i.daPath), ['/']);
});

test('computeSyncSummary reports counts + syncedAt and caches to status.json', async () => {
  const dest = join(tmpdir(), `aem-local-summary-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  try {
    assert.equal(await computeSyncSummary({ destRoot: dest, org: 'o', repo: 'r' }), null);

    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      syncedAt: '2026-08-01T10:00:00.000Z',
      files: [{ daPath: '/a.html' }, { daPath: '/b.html' }],
    }));
    // a.html modified locally, b.html unchanged, c.html new local-only.
    await writeFile(join(aemDir, 'a.html'), 'orig');
    await writeFile(join(workDir, 'a.html'), 'changed');
    await writeFile(join(aemDir, 'b.html'), 'same');
    await writeFile(join(workDir, 'b.html'), 'same');
    await writeFile(join(workDir, 'c.html'), 'new');

    const summary = await computeSyncSummary({ destRoot: dest, org: 'o', repo: 'r' });
    assert.equal(summary.fileCount, 2);
    assert.equal(summary.syncedAt, '2026-08-01T10:00:00.000Z');
    assert.equal(summary.modifiedCount, 1);
    assert.equal(summary.newCount, 1);
    assert.equal(summary.deletedCount, 0);

    // The summary was cached to .aem/status.json.
    const cached = JSON.parse(await readFile(statusCachePath(dest, 'o', 'r'), 'utf8'));
    assert.equal(cached.modifiedCount, 1);
    assert.equal(cached.fileCount, 2);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('computeSyncSummary returns null without a destRoot', async () => {
  assert.equal(await computeSyncSummary({ destRoot: null, org: 'o', repo: 'r' }), null);
});

test('readCachedSyncSummary prefers the cache, else falls back to the manifest', async () => {
  const dest = join(tmpdir(), `aem-cached-summary-${Date.now()}`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  try {
    // No manifest, no cache → null.
    assert.equal(await readCachedSyncSummary({ destRoot: dest, org: 'o', repo: 'r' }), null);

    // Manifest only → cheap fields, modified counts null (to be filled fresh).
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      syncedAt: '2026-08-01T10:00:00.000Z',
      files: [{ daPath: '/a.html' }],
    }));
    let cached = await readCachedSyncSummary({ destRoot: dest, org: 'o', repo: 'r' });
    assert.equal(cached.fileCount, 1);
    assert.equal(cached.syncedAt, '2026-08-01T10:00:00.000Z');
    assert.equal(cached.modifiedCount, null);

    // With a status cache → returned verbatim.
    await writeFile(statusCachePath(dest, 'o', 'r'), JSON.stringify({
      fileCount: 1, syncedAt: '2026-08-01T10:00:00.000Z', modifiedCount: 4, newCount: 0, deletedCount: 0,
    }));
    cached = await readCachedSyncSummary({ destRoot: dest, org: 'o', repo: 'r' });
    assert.equal(cached.modifiedCount, 4);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('media transform round-trips: download rewrites working, push sends ./media back', async () => {
  const dest = join(tmpdir(), `aem-media-roundtrip-${Date.now()}`);
  const origin = 'https://main--r--o.aem.page';
  const daPath = '/docs/x.html';
  const remoteHtml = '<img src="./media_abc1234567.png#width=10">';
  const uploads = [];
  const client = {
    backend: 'da.live',
    downloadRaw: async () => ({ buffer: Buffer.from(remoteHtml, 'utf8'), contentType: 'text/html' }),
    uploadSource: async (_org, _repo, p, buf) => { uploads.push({ p, body: buf.toString('utf8') }); },
  };
  const { workingPath, originalPath } = syncPaths(dest, 'o', 'r', daPath);

  try {
    // Download: working gets absolute media, .aem original stays pristine.
    await runSync({
      client,
      org: 'o',
      repo: 'r',
      items: [{
        daPath, isFolder: false, ext: 'html', lastModified: '2026-01-01T00:00:00Z',
      }],
      destRoot: dest,
      includeBinaries: true,
      mediaOrigin: origin,
      onProgress: () => {},
    });

    assert.equal(
      await readFile(workingPath, 'utf8'),
      '<img src="https://main--r--o.aem.page/docs/media_abc1234567.png#width=10">',
      'working copy has absolute media',
    );
    assert.equal(await readFile(originalPath, 'utf8'), remoteHtml, '.aem original stays ./media');

    // The transform alone must not read as a local edit.
    const clean = await checkPushStatus({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(clean.modified, [], 'download transform is not a modification');

    // A genuine edit (keeping the absolute media) is detected.
    await writeFile(
      workingPath,
      '<img src="https://main--r--o.aem.page/docs/media_abc1234567.png#width=10"><p>edit</p>',
    );
    const edited = await checkPushStatus({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(edited.modified, [daPath], 'real edit is detected');

    // Push uploads the pristine ./media form (not absolute) and updates .aem.
    await runPush({
      client,
      org: 'o',
      repo: 'r',
      destRoot: dest,
      filesToPush: [daPath],
      filesToDelete: [],
      onProgress: () => {},
    });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].body, '<img src="./media_abc1234567.png#width=10"><p>edit</p>');
    assert.equal(await readFile(originalPath, 'utf8'), uploads[0].body, '.aem now matches what was sent');

    // After push, nothing is pending.
    const after = await checkPushStatus({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(after.modified, []);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('isPushableLocalNewFile allows html/json/ico at the root, hides other root artifacts', () => {
  // Root-level: only .html, .json, and .ico (favicon) count as new content.
  assert.equal(isPushableLocalNewFile('/index.html'), true);
  assert.equal(isPushableLocalNewFile('/config.json'), true);
  assert.equal(isPushableLocalNewFile('/favicon.ico'), true);
  assert.equal(isPushableLocalNewFile('/notes.csv'), false);
  assert.equal(isPushableLocalNewFile('/hero.png'), false);
  // Nested files of any extension are always pushable.
  assert.equal(isPushableLocalNewFile('/assets/favicon.ico'), true);
  assert.equal(isPushableLocalNewFile('/blog/hero.png'), true);
});

test('checkPullStatus (helix6) detects source changes via the log', async () => {
  const dest = join(tmpdir(), `aem-logpull-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  const watermark = '2026-08-01T00:00:00.000Z';
  try {
    await mkdir(aemDir, { recursive: true });
    // /index.html: tracked, working == original (clean → outdated on change).
    await writeFile(join(workDir, 'index.html'), 'orig');
    await writeFile(join(aemDir, 'index.html'), 'orig');
    // /edited.html: tracked but locally modified (→ conflict on change).
    await writeFile(join(workDir, 'edited.html'), 'LOCAL');
    await writeFile(join(aemDir, 'edited.html'), 'orig');
    // /gone.html: tracked, will be deleted remotely (clean → deletedRemotely).
    await writeFile(join(workDir, 'gone.html'), 'orig');
    await writeFile(join(aemDir, 'gone.html'), 'orig');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o',
      repo: 'r',
      syncedAt: watermark,
      lastCheckedAt: watermark,
      files: [
        { daPath: '/index.html', lastModified: watermark },
        { daPath: '/edited.html', lastModified: watermark },
        { daPath: '/gone.html', lastModified: watermark },
      ],
    }));

    const ts = Date.parse('2026-08-02T00:00:00.000Z');
    const client = {
      backend: 'api.aem.live',
      getLog: async (_org, _repo, { to }) => ({
        to,
        entries: [
          {
            route: 'source', method: 'PUT', path: '/index.html', status: 200, timestamp: ts, ref: 'main',
          },
          {
            route: 'source', method: 'POST', path: '/edited.html', status: 201, timestamp: ts, ref: 'main',
          },
          {
            route: 'source', method: 'DELETE', path: '/gone.html', status: 200, timestamp: ts, ref: 'main',
          },
          // New file under a synced dir (root) → pulled as new.
          {
            route: 'source', method: 'POST', path: '/fresh.html', status: 201, timestamp: ts, ref: 'main',
          },
          // Noise that must be ignored:
          {
            route: 'preview', method: 'POST', path: '/index.html', status: 200, timestamp: ts, ref: 'main',
          },
          {
            route: 'source', method: 'POST', path: '/index.html/.versions', status: 201, timestamp: ts, ref: 'main',
          },
        ],
      }),
    };

    const status = await checkPullStatus({
      client, org: 'o', repo: 'r', destRoot: dest, ref: 'main',
    });

    assert.deepEqual(status.outdated.sort(), ['/fresh.html', '/index.html']);
    assert.deepEqual(status.conflicts, ['/edited.html']);
    assert.deepEqual(status.deletedRemotely, ['/gone.html']);
    assert.equal(status.totalCount, 4);
    // Watermark advances to the check time (now), past the old watermark.
    assert.ok(Date.parse(status.lastCheckedAt) > Date.parse(watermark));
    assert.ok(Date.now() - Date.parse(status.lastCheckedAt) < 60_000);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('touchPullCheckedAt stamps lastCheckedAt without pulling', async () => {
  const dest = join(tmpdir(), `aem-touch-${Date.now()}`);
  const aemDir = join(dest, 'o', 'r', '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o', repo: 'r', syncedAt: '2026-01-01T00:00:00.000Z', files: [],
    }));
    const when = '2026-08-11T12:00:00.000Z';
    const summary = await touchPullCheckedAt({
      destRoot: dest, org: 'o', repo: 'r', lastCheckedAt: when,
    });
    assert.equal(summary.lastCheckedAt, when);
    const manifest = JSON.parse(await readFile(join(aemDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.lastCheckedAt, when);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkPushStatus does not flag HTML whose server original already uses absolute media', async () => {
  // Regression: some sites store absolute same-origin media in the source, so
  // reverse-normalizing only the working copy flagged untouched files forever.
  const dest = join(tmpdir(), `aem-abs-media-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  const absolute = '<img src="https://main--r--o.aem.page/media_abc1234567.png#width=10">';
  try {
    await mkdir(aemDir, { recursive: true });
    // Working == original == absolute (downloaded, never edited).
    await writeFile(join(workDir, 'index.html'), absolute);
    await writeFile(join(aemDir, 'index.html'), absolute);
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o', repo: 'r', files: [{ daPath: '/index.html' }],
    }));

    const status = await checkPushStatus({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(status.modified, [], 'absolute-media original is not a modification');

    // A genuine edit is still detected.
    await writeFile(join(workDir, 'index.html'), `${absolute}<p>edit</p>`);
    const edited = await checkPushStatus({ destRoot: dest, org: 'o', repo: 'r' });
    assert.deepEqual(edited.modified, ['/index.html']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkLocalSyncBadges ignores the media rewrite (no phantom modified/conflict badge)', async () => {
  const dest = join(tmpdir(), `aem-badge-media-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  const lm = '2026-01-01T00:00:00Z';
  try {
    await mkdir(aemDir, { recursive: true });
    // Working has absolute media (download rewrite); .aem has pristine ./media.
    await writeFile(join(workDir, 'a.html'), '<img src="https://main--r--o.aem.page/media_abc1234567.png">');
    await writeFile(join(aemDir, 'a.html'), '<img src="./media_abc1234567.png">');
    // A genuinely edited file, for contrast.
    await writeFile(join(workDir, 'b.html'), '<p>local edit</p>');
    await writeFile(join(aemDir, 'b.html'), '<p>orig</p>');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o',
      repo: 'r',
      files: [
        { daPath: '/a.html', lastModified: lm },
        { daPath: '/b.html', lastModified: lm },
      ],
    }));

    const { badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      items: [
        { daPath: '/a.html', isFolder: false, lastModified: lm },
        { daPath: '/b.html', isFolder: false, lastModified: lm },
      ],
    });

    assert.equal(badges['/a.html'], 'synced', 'media-only rewrite is not a local edit');
    assert.equal(badges['/b.html'], 'modified', 'a real edit still shows modified');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('checkLocalSyncBadges tolerates sub-second lastModified rounding', async () => {
  const dest = join(tmpdir(), `aem-badge-lm-${Date.now()}`);
  const workDir = join(dest, 'o', 'r');
  const aemDir = join(workDir, '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    // Unchanged file, but listing rounds ms → whole second.
    await writeFile(join(workDir, 'a.json'), '{"x":1}');
    await writeFile(join(aemDir, 'a.json'), '{"x":1}');
    // Genuinely newer on the server (days apart).
    await writeFile(join(workDir, 'b.json'), '{"y":1}');
    await writeFile(join(aemDir, 'b.json'), '{"y":1}');
    await writeFile(join(aemDir, 'manifest.json'), JSON.stringify({
      org: 'o',
      repo: 'r',
      files: [
        { daPath: '/a.json', lastModified: '2026-08-14T19:04:49.791Z' },
        { daPath: '/b.json', lastModified: '2026-08-10T00:00:00.000Z' },
      ],
    }));

    const { badges } = await checkLocalSyncBadges({
      destRoot: dest,
      org: 'o',
      repo: 'r',
      items: [
        { daPath: '/a.json', isFolder: false, lastModified: '2026-08-14T19:04:50.000Z' },
        { daPath: '/b.json', isFolder: false, lastModified: '2026-08-24T17:28:45.000Z' },
      ],
    });

    assert.equal(badges['/a.json'], 'synced', 'sub-second rounding is not outdated');
    assert.equal(badges['/b.json'], 'outdated', 'a real multi-day change is still outdated');
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
