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
 * Loads and caches `/metadata.json` for local preview, matching rows to preview paths.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { toMetaName } from './section-metadata-html.js';

/**
 * @param {string} glob
 * @returns {RegExp|null}
 */
export function globToRegExp(glob) {
  const reString = glob
    .replaceAll('**', '|')
    .replaceAll('*', '[0-9a-z-.]*')
    .replaceAll('|', '.*');
  try {
    return new RegExp(`^${reString}$`, 'i');
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {object[]}
 */
export function parseMetadataJsonRows(raw) {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const sheet = /** @type {{ data?: unknown }} */ (raw).default ?? raw;
  const { data } = /** @type {{ data?: unknown }} */ (sheet);
  if (Array.isArray(data)) {
    return data.filter((row) => row && typeof row === 'object');
  }
  if (Array.isArray(raw)) {
    return raw.filter((row) => row && typeof row === 'object');
  }
  return [];
}

/**
 * @param {string} text
 * @returns {string}
 */
function readRowUrl(text) {
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * @param {object} row
 * @returns {string}
 */
function rowUrlPattern(row) {
  const rec = /** @type {Record<string, unknown>} */ (row);
  return readRowUrl(
    rec.URL ?? rec.url ?? rec.Url,
  );
}

/**
 * @param {string} pattern
 * @param {string} previewPath
 * @returns {boolean}
 */
export function matchMetadataPattern(pattern, previewPath) {
  if (!pattern) {
    return false;
  }
  if (!pattern.includes('*')) {
    return pattern === previewPath;
  }
  const re = globToRegExp(pattern);
  return re ? re.test(previewPath) : false;
}

/**
 * @param {object[]} rows
 * @param {string} previewPath
 * @returns {Record<string, string>|null}
 */
export function resolveMetadataSheetRow(rows, previewPath) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  /** @type {Record<string, string>} */
  const merged = {};

  for (const row of rows) {
    const pattern = rowUrlPattern(row);
    if (!pattern || !matchMetadataPattern(pattern, previewPath)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const rec = /** @type {Record<string, unknown>} */ (row);
    const lower = Object.fromEntries(
      Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const key = readRowUrl(String(lower.key ?? ''));
    const value = readRowUrl(String(lower.value ?? ''));

    if (key && value && 'key' in lower && 'value' in lower) {
      merged[toMetaName(key)] = value;
      // eslint-disable-next-line no-continue
      continue;
    }

    for (const [k, v] of Object.entries(rec)) {
      const name = k.toLowerCase();
      if (name === 'url' || k.startsWith(':')) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (v === undefined || v === null) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const s = String(v).trim();
      if (s) {
        merged[toMetaName(k)] = s;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * @param {string} syncRootDir
 * @returns {Promise<object[]|null>}
 */
export async function readLocalMetadataJson(syncRootDir) {
  const filePath = join(syncRootDir, 'metadata.json');
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return null;
    }
    const raw = JSON.parse(await readFile(filePath, 'utf-8'));
    const rows = parseMetadataJsonRows(raw);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} previewUrlOrigin
 * @param {Map<string, object[]>} cache
 * @param {typeof fetch} fetchFn
 * @returns {Promise<object[]>}
 */
export async function fetchRemoteMetadataJson(previewUrlOrigin, cache, fetchFn = fetch) {
  const origin = previewUrlOrigin.replace(/\/+$/, '');
  const cached = cache.get(origin);
  if (cached) {
    return cached;
  }

  const url = `${origin}/metadata.json`;
  /** @type {object[]} */
  let rows = [];
  try {
    const resp = await fetchFn(url, { cache: 'no-store' });
    if (resp.ok) {
      const raw = JSON.parse(await resp.text());
      rows = parseMetadataJsonRows(raw);
    }
  } catch {
    // leave empty
  }

  cache.set(origin, rows);
  return rows;
}

/**
 * @param {{
 *   previewUrlOrigin: string,
 *   syncRootDir: string,
 *   cache: Map<string, object[]>,
 *   fetchFn?: typeof fetch,
 * }} options
 * @returns {Promise<object[]>}
 */
export async function resolveMetadataJsonRows({
  previewUrlOrigin, syncRootDir, cache, fetchFn = fetch,
}) {
  const local = await readLocalMetadataJson(syncRootDir);
  if (local) {
    return local;
  }
  return fetchRemoteMetadataJson(previewUrlOrigin, cache, fetchFn);
}

/**
 * @param {{
 *   previewUrlOrigin: string,
 *   syncRootDir: string,
 *   previewPath: string,
 *   cache: Map<string, object[]>,
 *   fetchFn?: typeof fetch,
 * }} options
 * @returns {Promise<Record<string, string>|null>}
 */
export async function resolveMetadataSheetRowForPath(options) {
  const rows = await resolveMetadataJsonRows(options);
  return resolveMetadataSheetRow(rows, options.previewPath);
}

/**
 * @returns {{
 *   cache: Map<string, object[]>,
 *   resolveSheetRow: typeof resolveMetadataSheetRowForPath,
 *   clear: (previewUrlOrigin?: string) => void,
 * }}
 */
export function createMetadataJsonCache() {
  /** @type {Map<string, object[]>} */
  const cache = new Map();

  return {
    cache,
    resolveSheetRow: (options) => resolveMetadataSheetRowForPath({ ...options, cache }),
    clear(previewUrlOrigin) {
      if (previewUrlOrigin) {
        cache.delete(previewUrlOrigin.replace(/\/+$/, ''));
        return;
      }
      cache.clear();
    },
  };
}
