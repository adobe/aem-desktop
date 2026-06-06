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

/**
 * Parses an AEM preview URL (e.g. https://main--id--davidnuescheler.aem.page/)
 * into org/repo identity used by the DA admin API.
 *
 * @param {string} input
 * @returns {{ org: string, repo: string, branch: string, previewUrl: string }}
 */
export function parseAemPageUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('URL is required');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('URL must use https');
  }

  const parts = url.hostname.split('.');
  if (parts.length < 3) {
    throw new Error('Not a valid .aem.page or .hlx.page URL');
  }

  const domain = parts[1];
  const tld = parts[2];
  if (!['aem', 'hlx'].includes(domain) || !['page', 'live'].includes(tld)) {
    throw new Error('Not a valid .aem.page or .hlx.page URL');
  }

  const segments = parts[0].split('--');
  if (segments.length < 3) {
    throw new Error('URL must include branch, repo, and org (e.g. main--id--davidnuescheler.aem.page)');
  }

  const branch = segments[0];
  const org = segments[segments.length - 1];
  const repo = segments.slice(1, -1).join('--');

  if (!branch || !repo || !org) {
    throw new Error('Could not extract branch, repo, and org from URL');
  }

  return {
    org: org.toLowerCase(),
    repo: repo.toLowerCase(),
    branch,
    previewUrl: url.origin,
  };
}

/**
 * Strips the /{org}/{repo} prefix from a DA list entry path.
 *
 * @param {string} fullPath - e.g. /davidnuescheler/id/blog/post.html
 * @param {string} org
 * @param {string} repo
 * @returns {string} repo-relative path, e.g. /blog/post.html
 */
export function toDaPath(fullPath, org, repo) {
  const prefix = `/${org}/${repo}`;
  if (fullPath.startsWith(prefix)) {
    const relative = fullPath.slice(prefix.length);
    return relative || '/';
  }
  return fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
}
