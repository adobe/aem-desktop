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

import { normalizeDaPath, toApiRelativePath } from './content-api-shared.js';

export const AEM_API_BASE = 'https://api.aem.live';

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @returns {string}
 */
export function buildAemApiListUrl(org, repo, daPath) {
  const rel = toApiRelativePath(daPath);
  const base = `${AEM_API_BASE}/${org}/sites/${repo}/source`;
  if (!rel) {
    return `${base}/`;
  }
  return `${base}/${rel}/`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @returns {string}
 */
export function buildAemApiSourceUrl(org, repo, daPath) {
  const rel = toApiRelativePath(daPath);
  const base = `${AEM_API_BASE}/${org}/sites/${repo}/source`;
  if (!rel) {
    return base;
  }
  return `${base}/${rel}`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function buildAemApiBulkPreviewUrl(org, repo) {
  return `${AEM_API_BASE}/${org}/sites/${repo}/preview/`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function buildAemApiBulkPublishUrl(org, repo) {
  return `${AEM_API_BASE}/${org}/sites/${repo}/live/`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} topic
 * @param {string} jobName
 * @returns {string}
 */
export function buildAemApiJobUrl(org, repo, topic, jobName) {
  const encTopic = encodeURIComponent(topic);
  const encJob = encodeURIComponent(jobName);
  return `${AEM_API_BASE}/${org}/sites/${repo}/jobs/${encTopic}/${encJob}`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} parentDaPath
 * @param {string} name
 * @returns {string}
 */
function fullListEntryPath(org, repo, parentDaPath, name) {
  const parent = normalizeDaPath(parentDaPath);
  const rel = parent === '/' ? `/${name}` : `${parent}/${name}`;
  return `/${org}/${repo}${rel}`;
}

/**
 * @param {object} entry
 * @param {string} org
 * @param {string} repo
 * @param {string} parentDaPath
 * @returns {{ path: string, name: string, ext?: string, lastModified?: string }}
 */
export function normalizeAemApiListEntry(entry, org, repo, parentDaPath) {
  const rawName = entry.name || '';
  const isFolder = entry['content-type'] === 'application/folder' || rawName.endsWith('/');
  const fileName = rawName.endsWith('/') ? rawName.slice(0, -1) : rawName;
  const path = fullListEntryPath(org, repo, parentDaPath, fileName);

  if (isFolder) {
    return {
      path,
      name: fileName,
      lastModified: entry['last-modified'] || entry.lastModified || undefined,
    };
  }

  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot + 1) : '';
  const name = dot >= 0 ? fileName.slice(0, dot) : fileName;
  return {
    path,
    name,
    ext,
    lastModified: entry['last-modified'] || entry.lastModified || undefined,
  };
}
