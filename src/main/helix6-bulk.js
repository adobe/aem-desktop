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
import { daPathToPreviewPath } from './preview-url.js';

/** Job states that indicate the bulk job is still running. */
export const HELIX6_JOB_ACTIVE_STATES = new Set([
  'created',
  'running',
  'pending',
  'scheduled',
  'starting',
]);

/**
 * @param {string} [state]
 * @returns {boolean}
 */
export function isHelix6JobActive(state) {
  if (!state) {
    return true;
  }
  return HELIX6_JOB_ACTIVE_STATES.has(String(state).toLowerCase());
}

/**
 * Maps pushed DA paths to helix6 bulk API path filters.
 *
 * @param {string[]} daPaths
 * @returns {string[]}
 */
export function daPathsToBulkPaths(daPaths) {
  const seen = new Set();
  /** @type {string[]} */
  const paths = [];
  for (const daPath of daPaths) {
    const bulk = daPathToPreviewPath(daPath);
    if (!seen.has(bulk)) {
      seen.add(bulk);
      paths.push(bulk);
    }
  }
  return paths;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs helix6 bulk preview and optional publish jobs with polling.
 *
 * @param {{
 *   client: {
 *     startBulkPreview: (org: string, repo: string, paths: string[]) => Promise<object>,
 *     startBulkPublish: (org: string, repo: string, paths: string[]) => Promise<object>,
 *     getJobStatus: (org: string, repo: string, topic: string, jobName: string) => Promise<object>,
 *   },
 *   org: string,
 *   repo: string,
 *   daPaths: string[],
 *   mode: 'preview' | 'preview-publish',
 *   onProgress: (data: object) => void,
 *   signal?: AbortSignal,
 *   pollIntervalMs?: number,
 * }} options
 */
export async function runHelix6BulkWorkflow({
  client,
  org,
  repo,
  daPaths,
  mode,
  onProgress,
  signal,
  pollIntervalMs = 1500,
}) {
  const paths = daPathsToBulkPaths(daPaths);
  if (paths.length === 0) {
    throw new Error('No paths to preview or publish');
  }

  onProgress({
    phase: 'starting',
    mode,
    pathCount: paths.length,
    paths,
  });

  /**
   * @param {string} topic
   * @param {(org: string, repo: string, paths: string[]) => Promise<object>} startFn
   */
  const runJob = async (topic, startFn) => {
    const started = await startFn(org, repo, paths);
    const job = started.job || started;
    const jobName = job.name;
    const jobTopic = job.topic || topic;
    if (!jobName) {
      throw new Error(`Bulk ${topic} job did not return a job name`);
    }

    onProgress({
      phase: 'job',
      topic: jobTopic,
      jobName,
      state: job.state || 'created',
      progress: job.progress || null,
    });

    while (true) {
      if (signal?.aborted) {
        throw new Error('Cancelled');
      }
      // eslint-disable-next-line no-await-in-loop, max-len
      const status = await client.getJobStatus(org, repo, jobTopic, jobName);
      const state = status.state || status.job?.state;
      onProgress({
        phase: 'job',
        topic: jobTopic,
        jobName,
        state,
        progress: status.progress || status.job?.progress || null,
      });
      if (!isHelix6JobActive(state)) {
        const normalized = String(state || '').toLowerCase();
        if (normalized === 'failed' || normalized === 'error') {
          throw new Error(`${jobTopic} job failed`);
        }
        return status;
      }
      await sleep(pollIntervalMs); // eslint-disable-line no-await-in-loop
    }
  };

  await runJob('preview', client.startBulkPreview.bind(client));
  if (mode === 'preview-publish') {
    await runJob('publish', client.startBulkPublish.bind(client));
  }

  onProgress({
    phase: 'done',
    mode,
    pathCount: paths.length,
  });
}
