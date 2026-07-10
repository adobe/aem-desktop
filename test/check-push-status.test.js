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
  mkdir, writeFile, rm, copyFile, readFile, stat,
} from 'node:fs/promises';
import {
  checkPushStatus, syncPaths, manifestPath, runRevert, isPushableLocalNewFile,
} from '../src/main/da-sync.js';

test('isPushableLocalNewFile allows root html/json and nested files', () => {
  assert.equal(isPushableLocalNewFile('/index.html'), true);
  assert.equal(isPushableLocalNewFile('/config.json'), true);
  assert.equal(isPushableLocalNewFile('/data.csv'), false);
  assert.equal(isPushableLocalNewFile('/notes.md'), false);
  assert.equal(isPushableLocalNewFile('/script.js'), false);
  assert.equal(isPushableLocalNewFile('/blog/post.md'), true);
  assert.equal(isPushableLocalNewFile('/assets/data.csv'), true);
});

test('checkPushStatus omits non-html/json root files from localNew', async () => {
  const dest = join(tmpdir(), `aem-push-root-filter-${Date.now()}`);
  const org = 'o';
  const repo = 'r';
  const workDir = join(dest, org, repo);
  const aemDir = join(workDir, '.aem');
  try {
    await mkdir(aemDir, { recursive: true });
    await mkdir(join(workDir, 'blog'), { recursive: true });
    await writeFile(manifestPath(dest, org, repo), JSON.stringify({
      org,
      repo,
      files: [],
    }));
    await writeFile(join(workDir, 'index.html'), 'home');
    await writeFile(join(workDir, 'config.json'), '{}');
    await writeFile(join(workDir, 'data.csv'), 'a,b');
    await writeFile(join(workDir, 'notes.md'), '# notes');
    await writeFile(join(workDir, 'script.js'), 'console.log(1)');
    await writeFile(join(workDir, 'blog', 'post.md'), '# post');

    const status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.deepEqual(status.localNew.sort(), ['/blog/post.md', '/config.json', '/index.html']);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

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

test('runRevert restores modified and deleted files from .aem with manifest mtime', async () => {
  const dest = join(tmpdir(), `aem-revert-test-${Date.now()}`);
  const org = 'o';
  const repo = 'r';
  const aemDir = join(dest, org, repo, '.aem');
  const workDir = join(dest, org, repo);
  const manifestMtime = '2026-03-15T12:00:00.000Z';
  try {
    await mkdir(aemDir, { recursive: true });
    await writeFile(manifestPath(dest, org, repo), JSON.stringify({
      org,
      repo,
      files: [
        { daPath: '/a.html', lastModified: manifestMtime },
        { daPath: '/b.html', lastModified: manifestMtime },
      ],
    }));
    await writeFile(join(aemDir, 'a.html'), 'original a');
    await writeFile(join(aemDir, 'b.html'), 'original b');
    await writeFile(join(workDir, 'a.html'), 'modified a');
    await rm(join(workDir, 'b.html'), { force: true });
    await writeFile(join(workDir, 'c.html'), 'local only');

    await runRevert({
      destRoot: dest,
      org,
      repo,
      files: [
        { daPath: '/a.html', status: 'modified' },
        { daPath: '/b.html', status: 'deleted' },
        { daPath: '/c.html', status: 'new' },
      ],
      onProgress: () => {},
    });

    assert.equal(await readFile(join(workDir, 'a.html'), 'utf8'), 'original a');
    assert.equal(await readFile(join(workDir, 'b.html'), 'utf8'), 'original b');

    const aStat = await stat(join(workDir, 'a.html'));
    assert.equal(aStat.mtime.toISOString(), manifestMtime);

    let missing = false;
    try {
      await stat(join(workDir, 'c.html'));
    } catch {
      missing = true;
    }
    assert.equal(missing, true);

    const status = await checkPushStatus({ destRoot: dest, org, repo });
    assert.equal(status.modified.length, 0);
    assert.equal(status.localNew.length, 0);
    assert.equal(status.deleted.length, 0);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
