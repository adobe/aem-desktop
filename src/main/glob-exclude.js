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
 * Converts a simple glob to an anchored RegExp matched against a full daPath.
 * `*` matches any run of characters (including `/`) and `?` matches a single
 * character; every other regex metacharacter is escaped, so author-friendly
 * patterns like `* /recipes/*` behave predictably.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  const escaped = String(glob).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

/**
 * Parses a comma-separated list of exclude globs into RegExp matchers, ignoring
 * blank entries.
 *
 * @param {string|null|undefined} input
 * @returns {RegExp[]}
 */
export function parseExcludeGlobs(input) {
  if (!input) {
    return [];
  }
  return String(input)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

/**
 * @param {string} daPath
 * @param {RegExp[]} matchers
 * @returns {boolean} true if the path matches any exclude glob
 */
export function isPathExcluded(daPath, matchers) {
  return matchers.some((re) => re.test(daPath));
}

/**
 * Removes files whose daPath matches any of the comma-separated exclude globs.
 *
 * @template {{ daPath: string }} T
 * @param {T[]} files
 * @param {string|null|undefined} excludeGlobs
 * @returns {T[]}
 */
export function applyExcludeGlobs(files, excludeGlobs) {
  const matchers = parseExcludeGlobs(excludeGlobs);
  if (matchers.length === 0) {
    return files;
  }
  return files.filter((file) => !isPathExcluded(file.daPath, matchers));
}
