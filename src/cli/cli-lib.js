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
 * Pure argument/selector helpers for the `content` CLI. Kept free of Node and
 * Electron APIs so they are unit-testable under `node --test`.
 */

/**
 * Minimal argv parser: a leading command, positional arguments, `--flag`,
 * `--flag=value`, `--flag value` (for known value flags), and bundled short
 * boolean flags (`-yv`). Everything after a bare `--` is treated as positional.
 *
 * @param {string[]} argv - typically `process.argv.slice(2)`
 * @param {{ valueFlags?: string[] }} [options] - flags taking the next token
 * @returns {{ command?: string, positionals: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv, { valueFlags = [] } = {}) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        if (valueFlags.includes(key)) {
          i += 1;
          flags[key] = argv[i] ?? '';
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.length > 1 && arg.startsWith('-')) {
      for (const ch of arg.slice(1)) {
        flags[ch] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

/**
 * `org/repo` label for a site.
 *
 * @param {{ org: string, repo: string }} site
 * @returns {string}
 */
export function siteLabel(site) {
  return `${site.org}/${site.repo}`;
}

/**
 * Resolves a site selector against the configured sites. A selector may be a
 * 1-based index (`content sites` order), a full or prefix id, `org/repo`, or a
 * bare `repo` when unambiguous. With no selector, a lone configured site is
 * returned; otherwise the caller must disambiguate.
 *
 * @template {{ id: string, org: string, repo: string }} T
 * @param {T[]} sites
 * @param {string|undefined|null} selector
 * @returns {T}
 */
export function resolveSite(sites, selector) {
  if (!sites || sites.length === 0) {
    throw new Error('No sites configured. Add one in AEM Desktop first.');
  }

  if (selector == null || selector === '') {
    if (sites.length === 1) {
      return sites[0];
    }
    throw new Error(
      'Multiple sites configured — specify one by org/repo, index, or id. Run "content sites".',
    );
  }

  const sel = String(selector);

  if (/^\d+$/.test(sel)) {
    const idx = Number(sel) - 1;
    if (idx < 0 || idx >= sites.length) {
      throw new Error(`Site index ${sel} is out of range (1-${sites.length}).`);
    }
    return sites[idx];
  }

  const byId = sites.filter((s) => s.id === sel || s.id.startsWith(sel));
  if (byId.length === 1) {
    return byId[0];
  }

  if (sel.includes('/')) {
    const [org, repo] = sel.split('/');
    const match = sites.find((s) => s.org === org && s.repo === repo);
    if (match) {
      return match;
    }
  }

  const byRepo = sites.filter((s) => s.repo === sel);
  if (byRepo.length === 1) {
    return byRepo[0];
  }
  if (byRepo.length > 1) {
    throw new Error(`"${sel}" matches multiple sites — use org/repo to disambiguate.`);
  }

  throw new Error(`No site matches "${sel}". Run "content sites" to list them.`);
}

/**
 * Splits comma-separated exclude globs into a trimmed, non-empty list.
 *
 * @param {string|boolean|undefined} value
 * @returns {string[]}
 */
export function parseExcludeArg(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Turns positional path arguments into `runSync` selection items. A path that
 * ends in `/` or has no file extension is treated as a folder (recursively
 * listed); anything with an extension is treated as a single file. With no
 * paths, the whole site (`/`) is selected.
 *
 * @param {string[]} paths
 * @returns {{ daPath: string, isFolder: boolean, ext: string|null, lastModified: null }[]}
 */
export function pathsToSyncItems(paths) {
  if (!paths || paths.length === 0) {
    return [{
      daPath: '/', isFolder: true, ext: null, lastModified: null,
    }];
  }
  return paths.map((raw) => {
    let daPath = raw.startsWith('/') ? raw : `/${raw}`;
    const trailingSlash = daPath.endsWith('/') && daPath !== '/';
    if (trailingSlash) {
      daPath = daPath.replace(/\/+$/, '') || '/';
    }
    const base = daPath.slice(daPath.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const ext = !trailingSlash && dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
    const isFolder = trailingSlash || ext == null;
    return {
      daPath, isFolder, ext, lastModified: null,
    };
  });
}
