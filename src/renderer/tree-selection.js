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
 * Collects all items visible in the expanded tree (depth-first).
 *
 * @param {Record<string, object[]>} cache
 * @param {Set<string>} expanded
 * @param {string} [rootPath='/']
 * @returns {object[]}
 */
export function collectVisibleItems(cache, expanded, rootPath = '/') {
  const result = [];

  function walk(daPath) {
    const items = cache[daPath];
    if (!items) {
      return;
    }

    const folders = items.filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));
    const files = items.filter((i) => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name));

    for (const item of [...folders, ...files]) {
      result.push(item);
      if (item.isFolder && expanded.has(item.daPath)) {
        walk(item.daPath);
      }
    }
  }

  walk(rootPath);
  return result;
}

/**
 * @param {string[]} visiblePaths
 * @param {string|null} anchorPath
 * @param {string} daPath
 * @param {Set<string>} selectedPaths
 * @returns {number}
 */
function resolveAnchorIndex(visiblePaths, anchorPath, daPath, selectedPaths) {
  if (anchorPath != null && visiblePaths.includes(anchorPath)) {
    return visiblePaths.indexOf(anchorPath);
  }

  for (let i = 0; i < visiblePaths.length; i += 1) {
    if (selectedPaths.has(visiblePaths[i])) {
      return i;
    }
  }

  return visiblePaths.indexOf(daPath);
}

/**
 * macOS Finder-style click selection (plain / ⌘ / ⇧ / ⌘⇧).
 *
 * @param {{
 *   visiblePaths: string[],
 *   selectedPaths: Set<string>|string[],
 *   anchorPath: string|null,
 *   daPath: string,
 *   metaKey: boolean,
 *   shiftKey: boolean,
 * }} options
 * @returns {{ selectedPaths: Set<string>, anchorPath: string }}
 */
export function applyFinderClick({
  visiblePaths,
  selectedPaths,
  anchorPath,
  daPath,
  metaKey,
  shiftKey,
}) {
  const selected = new Set(selectedPaths);
  let anchor = anchorPath;

  if (shiftKey && visiblePaths.length > 0) {
    const targetIdx = visiblePaths.indexOf(daPath);
    if (targetIdx === -1) {
      selected.clear();
      selected.add(daPath);
      anchor = daPath;
      return { selectedPaths: selected, anchorPath: anchor };
    }

    const anchorIdx = resolveAnchorIndex(visiblePaths, anchor, daPath, selected);
    const lo = Math.min(anchorIdx, targetIdx);
    const hi = Math.max(anchorIdx, targetIdx);

    if (!metaKey) {
      selected.clear();
    }
    for (let i = lo; i <= hi; i += 1) {
      selected.add(visiblePaths[i]);
    }
    anchor = daPath;
    return { selectedPaths: selected, anchorPath: anchor };
  }

  if (metaKey) {
    if (selected.has(daPath)) {
      selected.delete(daPath);
    } else {
      selected.add(daPath);
    }
    anchor = daPath;
    return { selectedPaths: selected, anchorPath: anchor };
  }

  selected.clear();
  selected.add(daPath);
  anchor = daPath;
  return { selectedPaths: selected, anchorPath: anchor };
}

/**
 * @param {string[]} visiblePaths
 * @returns {Set<string>}
 */
export function selectAllPaths(visiblePaths) {
  return new Set(visiblePaths);
}
