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
  daPathsToBulkPaths,
  isHelix6JobActive,
  runHelix6BulkWorkflow,
} from '../src/main/helix6-bulk.js';

test('daPathsToBulkPaths maps html and preserves json paths', () => {
  const paths = daPathsToBulkPaths([
    '/blog/post.html',
    '/metadata.json',
    '/styles.css',
  ]);
  assert.deepEqual(paths, ['/blog/post', '/metadata.json', '/styles.css']);
});

test('isHelix6JobActive recognizes running states', () => {
  assert.equal(isHelix6JobActive('running'), true);
  assert.equal(isHelix6JobActive('succeeded'), false);
});

test('runHelix6BulkWorkflow previews then publishes when requested', async () => {
  const calls = [];
  const client = {
    startBulkPreview: async (org, repo, paths) => {
      calls.push(['preview', paths]);
      return { job: { topic: 'preview', name: 'job-1', state: 'created' } };
    },
    startBulkPublish: async (org, repo, paths) => {
      calls.push(['publish', paths]);
      return { job: { topic: 'publish', name: 'job-2', state: 'created' } };
    },
    getJobStatus: async (org, repo, topic, jobName) => {
      calls.push(['status', topic, jobName]);
      return {
        topic,
        name: jobName,
        state: 'succeeded',
        progress: { total: 2, processed: 2, failed: 0 },
      };
    },
  };

  const progress = [];
  await runHelix6BulkWorkflow({
    client,
    org: 'owner',
    repo: 'site',
    daPaths: ['/index.html', '/foo.json'],
    mode: 'preview-publish',
    pollIntervalMs: 1,
    onProgress: (data) => progress.push(data),
  });

  assert.deepEqual(calls[0], ['preview', ['/', '/foo.json']]);
  assert.deepEqual(calls.find((c) => c[0] === 'publish'), ['publish', ['/', '/foo.json']]);
  assert.equal(progress.at(-1)?.phase, 'done');
});
