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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseAemPageUrl } from './aem-page-url.js';
import {
  API_BACKEND_DA_LIVE,
  API_BACKEND_AEM_API,
  isValidApiBackend,
} from './da-api.js';

/**
 * @typedef {{
 *   id: string,
 *   org: string,
 *   repo: string,
 *   branch: string,
 *   previewUrl: string,
 *   apiBackend: string,
 *   addedAt: string,
 * }} Site
 */

/**
 * @param {string} storePath
 * @returns {Promise<Site[]>}
 */
export async function loadSites(storePath) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} storePath
 * @param {Site[]} sites
 */
export async function saveSites(storePath, sites) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(sites, null, 2)}\n`, 'utf8');
}

/**
 * @param {Site[]} sites
 * @param {string} url
 * @param {string} [apiBackend]
 * @returns {{ site: Site, sites: Site[] }}
 */
export function addSiteFromUrl(sites, url, apiBackend = API_BACKEND_DA_LIVE) {
  if (!isValidApiBackend(apiBackend)) {
    throw new Error(`Invalid API backend: ${apiBackend}`);
  }

  const parsed = parseAemPageUrl(url);
  const duplicate = sites.find((s) => s.org === parsed.org && s.repo === parsed.repo);
  if (duplicate) {
    throw new Error(`Site ${parsed.org}/${parsed.repo} is already added`);
  }

  const site = {
    id: randomUUID(),
    org: parsed.org,
    repo: parsed.repo,
    branch: parsed.branch,
    previewUrl: parsed.previewUrl,
    apiBackend,
    addedAt: new Date().toISOString(),
  };

  return { site, sites: [...sites, site] };
}

export { API_BACKEND_DA_LIVE, API_BACKEND_AEM_API };

/**
 * @param {Site[]} sites
 * @param {string} id
 * @returns {Site[]}
 */
export function removeSite(sites, id) {
  const next = sites.filter((s) => s.id !== id);
  if (next.length === sites.length) {
    throw new Error('Site not found');
  }
  return next;
}

/**
 * @param {Site[]} sites
 * @param {string} id
 * @returns {Site|undefined}
 */
export function findSite(sites, id) {
  return sites.find((s) => s.id === id);
}
