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

import { normalizeDaPath } from './content-api-shared.js';

export const DA_ADMIN = 'https://admin.da.live';

/** Response header used to page past the per-request list limit. */
export const LIST_CONTINUATION_HEADER = 'da-continuation-token';

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @returns {string}
 */
export function buildDaLiveListUrl(org, repo, daPath) {
  const normalized = normalizeDaPath(daPath);
  return `${DA_ADMIN}/list/${org}/${repo}${normalized === '/' ? '/' : normalized}`;
}

/**
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @returns {string}
 */
export function buildDaLiveSourceUrl(org, repo, daPath) {
  const normalized = normalizeDaPath(daPath);
  return `${DA_ADMIN}/source/${org}/${repo}${normalized}`;
}
