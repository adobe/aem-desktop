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
 * @param {string} topic
 * @param {boolean} remove
 * @returns {string}
 */
export function helix6BulkActionLabel(topic, remove) {
  if (remove) {
    return topic === 'preview' ? 'unpreview' : 'unpublish';
  }
  return topic;
}

/**
 * Runs helix6 bulk preview and optional publish jobs with polling.
 *
 * @param {{
 *   client: {
 *     startBulkPreview: (
 *       org: string,
 *       repo: string,
 *       paths: string[],
 *       options?: { delete?: boolean },
 *     ) => Promise<object>,
 *     startBulkPublish: (
 *       org: string,
 *       repo: string,
 *       paths: string[],
 *       options?: { delete?: boolean },
 *     ) => Promise<object>,
 *     getJobStatus: (org: string, repo: string, topic: string, jobName: string) => Promise<object>,
 *   },
 *   org: string,
 *   repo: string,
 *   daPaths: string[],
 *   deletedDaPaths?: string[],
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
  deletedDaPaths = [],
  mode,
  onProgress,
  signal,
  pollIntervalMs = 1500,
}) {
  const updatedPaths = daPathsToBulkPaths(daPaths);
  const removedPaths = daPathsToBulkPaths(deletedDaPaths);
  const pathCount = updatedPaths.length + removedPaths.length;
  if (pathCount === 0) {
    throw new Error('No paths to preview or publish');
  }

  onProgress({
    phase: 'starting',
    mode,
    pathCount,
    updatedPaths,
    removedPaths,
  });

  /**
   * @param {string} topic
   * @param {string[]} paths
   * @param {{ delete?: boolean }} [options]
   */
  const runJob = async (topic, paths, { delete: remove = false } = {}) => {
    if (paths.length === 0) {
      return;
    }
    const action = helix6BulkActionLabel(topic, remove);
    const startFn = topic === 'preview'
      ? client.startBulkPreview.bind(client)
      : client.startBulkPublish.bind(client);
    const started = await startFn(org, repo, paths, { delete: remove });
    const job = started.job || started;
    const jobName = job.name;
    const jobTopic = job.topic || topic;
    if (!jobName) {
      throw new Error(`Bulk ${action} job did not return a job name`);
    }

    onProgress({
      phase: 'job',
      topic: jobTopic,
      action,
      delete: remove,
      jobName,
      state: job.state || 'created',
      progress: job.progress || null,
      pathCount: paths.length,
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
        action,
        delete: remove,
        jobName,
        state,
        progress: status.progress || status.job?.progress || null,
        pathCount: paths.length,
      });
      if (!isHelix6JobActive(state)) {
        const normalized = String(state || '').toLowerCase();
        if (normalized === 'failed' || normalized === 'error') {
          throw new Error(`${action} job failed`);
        }
        return;
      }
      await sleep(pollIntervalMs); // eslint-disable-line no-await-in-loop
    }
  };

  await runJob('preview', updatedPaths, { delete: false });
  if (mode === 'preview-publish') {
    await runJob('publish', updatedPaths, { delete: false });
  }
  await runJob('preview', removedPaths, { delete: true });
  if (mode === 'preview-publish') {
    await runJob('publish', removedPaths, { delete: true });
  }

  onProgress({
    phase: 'done',
    mode,
    pathCount,
  });
}
