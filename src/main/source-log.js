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
 * Reduces api.aem.live audit-log entries (getLog) to the set of source content
 * changes since a given point in time. A `source` route entry with method
 * POST/PUT is a create/update; DELETE is a removal; the latest entry per path
 * wins. Pure so it can be unit tested without the network.
 */

/**
 * Whether a source path is an internal artifact we should ignore — e.g. the
 * per-document `…/.versions` writes and any other dot-segment path.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isInternalSourcePath(path) {
  return String(path).split('/').some((seg) => seg.length > 0 && seg.startsWith('.'));
}

/**
 * @typedef {{ deleted: boolean, timestamp: number }} SourceChange
 */

/**
 * Collapses log entries to a map of daPath → latest change. Filters out
 * non-source routes, other branches (when `ref` is given), failed operations,
 * unknown methods, and internal paths.
 *
 * @param {Array<object>} entries
 * @param {string} [ref] - branch to keep; entries on other refs are dropped
 * @returns {Map<string, SourceChange>}
 */
export function extractSourceChanges(entries, ref) {
  /** @type {Map<string, SourceChange>} */
  const changes = new Map();
  for (const entry of entries || []) {
    if (!entry || entry.route !== 'source') {
      continue; // eslint-disable-line no-continue
    }
    if (ref && entry.ref && entry.ref !== ref) {
      continue; // eslint-disable-line no-continue
    }
    if (typeof entry.status === 'number' && (entry.status < 200 || entry.status >= 300)) {
      continue; // eslint-disable-line no-continue
    }
    const { path } = entry;
    if (!path || isInternalSourcePath(path)) {
      continue; // eslint-disable-line no-continue
    }
    const method = String(entry.method || '').toUpperCase();
    const deleted = method === 'DELETE';
    if (!deleted && method !== 'POST' && method !== 'PUT') {
      continue; // eslint-disable-line no-continue
    }
    const timestamp = Number(entry.timestamp) || 0;
    const existing = changes.get(path);
    if (!existing || timestamp >= existing.timestamp) {
      changes.set(path, { deleted, timestamp });
    }
  }
  return changes;
}
