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
import {
  mkdir, readdir, readFile, stat, writeFile, utimes, copyFile, rm,
} from 'node:fs/promises';
import {
  join, dirname, relative, extname,
} from 'node:path';
import {
  makeReadOnly, makeWritable, restoreTreeWritable, writeAemGuardFiles,
} from './aem-guard.js';
import { toDaPath } from './aem-page-url.js';
import { prettyPrintHtml } from './pretty-print.js';
import { myersDiff, buildHunks } from './diff.js';
import { contentTypeForUpload, API_BACKEND_AEM_API } from './content-api-shared.js';
import { applyExcludeGlobs } from './glob-exclude.js';
import { htmlNeedsMediaInterning } from './media-references.js';
import {
  isTransformableHtml, toAbsoluteMedia, toRelativeMedia,
} from './media-path-transform.js';
import { extractSourceChanges } from './source-log.js';

// A "check for updates" older than this can't rely on the log (too many entries
// to page through) and falls back to per-file remote metadata.
const MAX_LOG_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'json', 'css', 'js', 'mjs', 'xml', 'txt', 'md',
  'svg', 'yaml', 'yml', 'csv', 'tsv',
]);

/** Parallel sync ops per batch. Kept below the admin API 10 req/s ceiling. */
const CONCURRENCY = 5;

/**
 * @param {string|undefined} ext
 * @returns {boolean}
 */
export function isBinaryExtension(ext) {
  if (!ext) {
    return true;
  }
  return !TEXT_EXTENSIONS.has(ext.toLowerCase());
}

const PUSHABLE_ROOT_EXTENSIONS = new Set(['html', 'json', 'ico']);

/**
 * Root-level files that are not .html, .json, or .ico (favicon) are local
 * tooling artifacts (CSVs, scripts, notes) and should not appear in push/sync
 * diffs as new.
 *
 * @param {string} daPath
 * @returns {boolean}
 */
export function isPushableLocalNewFile(daPath) {
  const segments = daPath.split('/').filter(Boolean);
  if (segments.length !== 1) {
    return true;
  }
  const ext = extname(segments[0]).slice(1).toLowerCase();
  return PUSHABLE_ROOT_EXTENSIONS.has(ext);
}

/**
 * @param {string} destRoot
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @returns {{ workingPath: string, originalPath: string }}
 */
export function syncPaths(destRoot, org, repo, daPath) {
  const segments = daPath.split('/').filter(Boolean);
  return {
    workingPath: join(destRoot, org, repo, ...segments),
    originalPath: join(destRoot, org, repo, '.aem', ...segments),
  };
}

/**
 * @param {string} destRoot
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function manifestPath(destRoot, org, repo) {
  return join(destRoot, org, repo, '.aem', 'manifest.json');
}

/**
 * @param {string} destRoot
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function syncRoot(destRoot, org, repo) {
  return join(destRoot, org, repo);
}

/**
 * Path of the cached local-status summary (see {@link computeSyncSummary}),
 * stored alongside the manifest under `.aem`.
 *
 * @param {string} destRoot
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function statusCachePath(destRoot, org, repo) {
  return join(destRoot, org, repo, '.aem', 'status.json');
}

/**
 * @param {string} path
 * @returns {Promise<Buffer|null>}
 */
async function safeReadFile(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @returns {Promise<Date|null>}
 */
async function fileMtime(path) {
  try {
    const s = await stat(path);
    return s.mtime;
  } catch {
    return null;
  }
}

// Listing timestamps often round to whole seconds while the manifest keeps
// millisecond precision — both reflect the same source write, so a sub-second
// difference is not a change. Comparing them as exact strings made files show a
// phantom "outdated"/"new"/"conflict" after a sync even though nothing changed.
const REMOTE_TIME_TOLERANCE_MS = 1000;

/**
 * Whether the remote lastModified indicates a real change vs the manifest's.
 * Tolerant of sub-second precision/rounding differences between the source and
 * listing APIs; a new remote timestamp with no prior one counts as changed.
 *
 * @param {string|undefined|null} prevLastModified
 * @param {string|undefined|null} remoteLastModified
 * @returns {boolean}
 */
function isRemoteChanged(prevLastModified, remoteLastModified) {
  if (!remoteLastModified) {
    return false;
  }
  if (!prevLastModified) {
    return true;
  }
  const remoteMs = Date.parse(remoteLastModified);
  const prevMs = Date.parse(prevLastModified);
  if (Number.isNaN(remoteMs) || Number.isNaN(prevMs)) {
    return String(remoteLastModified) !== String(prevLastModified);
  }
  return Math.abs(remoteMs - prevMs) > REMOTE_TIME_TOLERANCE_MS;
}

/**
 * Recursively collects all file paths under a local directory,
 * returning them as DA-style paths (e.g. /blog/post.html).
 * Skips the .aem directory.
 */
async function walkLocalDir(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === '.aem' || entry.name.startsWith('.')) {
      continue; // eslint-disable-line no-continue
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkLocalDir(full)); // eslint-disable-line no-await-in-loop
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Names of immediate child directories of a local folder, skipping `.aem` and
 * dotfiles/dotdirs (mirrors {@link walkLocalDir}'s skip rules). Used to surface
 * local-only folders that have no remote listing entry yet.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listLocalChildDirs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== '.aem' && !entry.name.startsWith('.')) {
      dirs.push(entry.name);
    }
  }
  return dirs;
}

/**
 * Lists folder daPaths that have a corresponding directory under `.aem`
 * (i.e. content from that folder has been synced at least once).
 *
 * @param {string} destRoot
 * @param {string} org
 * @param {string} repo
 * @returns {Promise<string[]>}
 */
export async function collectSyncedFoldersFromAem(destRoot, org, repo) {
  const aemRoot = join(syncRoot(destRoot, org, repo), '.aem');
  const folders = new Set();

  async function walk(dir, relSegments) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'manifest.json' && relSegments.length === 0) {
        continue; // eslint-disable-line no-continue
      }
      if (entry.isDirectory()) {
        const segs = [...relSegments, entry.name];
        folders.add(`/${segs.join('/')}`);
        await walk(join(dir, entry.name), segs); // eslint-disable-line no-await-in-loop
      }
    }
  }

  await walk(aemRoot, []);
  return [...folders].sort((a, b) => a.localeCompare(b));
}

/**
 * Local-only sync badges for the content tree (no remote DA listing).
 * Folder "synced" badges come from `.aem` layout; file badges use the manifest,
 * on-disk copies, and optional `lastModified` from a single list response.
 *
 * @param {{
 *   destRoot: string,
 *   org: string,
 *   repo: string,
 *   folderPath?: string,
 *   items?: Array<{ daPath: string, isFolder?: boolean, lastModified?: string }>,
 * }} options
 * @returns {Promise<{ syncedFolders: string[], badges: Record<string, string> }>}
 */
export async function checkLocalSyncBadges({
  destRoot, org, repo, folderPath, items = [],
}) {
  const syncedFolders = await collectSyncedFoldersFromAem(destRoot, org, repo);
  /** @type {Record<string, string>} */
  const badges = {};
  for (const folder of syncedFolders) {
    badges[folder] = 'synced';
  }

  let manifestMap = new Map();
  try {
    const manifest = JSON.parse(await readFile(manifestPath(destRoot, org, repo), 'utf8'));
    for (const f of manifest.files || []) {
      manifestMap.set(f.daPath, f);
    }
  } catch {
    manifestMap = new Map();
  }

  /** @type {Promise<void>[]} */
  const itemChecks = [];

  for (const item of items) {
    if (item.isFolder) {
      continue; // eslint-disable-line no-continue
    }

    const prev = manifestMap.get(item.daPath);
    if (!prev) {
      itemChecks.push((async () => {
        const { workingPath } = syncPaths(destRoot, org, repo, item.daPath);
        const workingMtime = await fileMtime(workingPath);
        if (workingMtime) {
          badges[item.daPath] = 'new';
        }
      })());
      continue; // eslint-disable-line no-continue
    }

    itemChecks.push((async () => {
      const paths = syncPaths(destRoot, org, repo, item.daPath);
      const workingMtime = await fileMtime(paths.workingPath);
      if (!workingMtime) {
        badges[item.daPath] = 'deleted';
        return;
      }

      const origBuf = await safeReadFile(paths.originalPath);
      const workBuf = await safeReadFile(paths.workingPath);
      // Normalize media refs to ./media on BOTH sides before comparing, matching
      // checkPushStatus — otherwise the download's absolute-media rewrite (or
      // already-absolute server media) reads as a local edit here, showing a
      // phantom "modified"/"conflict" tree badge that review-changes never has.
      let localModified = false;
      if (origBuf && workBuf) {
        localModified = isTransformableHtml(item.daPath)
          ? toRelativeMedia(workBuf.toString('utf8'), item.daPath)
            !== toRelativeMedia(origBuf.toString('utf8'), item.daPath)
          : !origBuf.equals(workBuf);
      }

      const remoteChanged = isRemoteChanged(prev.lastModified, item.lastModified);

      if (localModified && remoteChanged) {
        badges[item.daPath] = 'conflict';
      } else if (localModified) {
        badges[item.daPath] = 'modified';
      } else if (remoteChanged) {
        badges[item.daPath] = 'outdated';
      } else {
        badges[item.daPath] = 'synced';
      }
    })());
  }

  await Promise.all(itemChecks);

  /** @type {string[]} */
  const localFolders = [];
  if (folderPath !== undefined) {
    const root = syncRoot(destRoot, org, repo);
    const segs = folderPath === '/' ? [] : folderPath.split('/').filter(Boolean);
    const localDir = join(root, ...segs);

    const localFiles = await walkLocalDir(localDir);
    for (const localPath of localFiles) {
      const rel = relative(root, localPath);
      const daPath = `/${rel}`;
      if (!manifestMap.has(daPath) && !badges[daPath] && isPushableLocalNewFile(daPath)) {
        badges[daPath] = 'new';
      }
    }

    // Surface local-only child folders (created on disk but not in the remote
    // listing) so they appear in the tree and can be expanded. Folders already
    // in the remote listing are skipped; genuinely local ones are badged 'new'.
    const remotePaths = new Set(items.map((item) => item.daPath));
    const base = folderPath === '/' ? '' : folderPath;
    for (const childName of await listLocalChildDirs(localDir)) {
      const daPath = `${base}/${childName}`;
      if (remotePaths.has(daPath)) {
        continue; // eslint-disable-line no-continue
      }
      localFolders.push(daPath);
      if (!badges[daPath]) {
        badges[daPath] = 'new';
      }
    }
  }

  return { syncedFolders, badges, localFolders };
}

/**
 * Reads the existing manifest and compares remote file states against
 * local copies to classify each file as new, updated, conflicted,
 * deleted locally, or local-only (exists on disk but not on remote).
 *
 * @param {{
 *   destRoot: string,
 *   org: string,
 *   repo: string,
 *   remoteFiles: Array<{daPath: string, lastModified?: string}>,
 *   scopePaths?: string[],
 * }} options
 */
export async function checkSyncStatus({
  destRoot, org, repo, remoteFiles, scopePaths,
}) {
  const mPath = manifestPath(destRoot, org, repo);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(mPath, 'utf8'));
  } catch {
    const syncedFolders = await collectSyncedFoldersFromAem(destRoot, org, repo);
    return {
      newCount: remoteFiles.length,
      modifiedCount: 0,
      outdatedCount: 0,
      conflictCount: 0,
      unchangedCount: 0,
      deletedLocallyCount: 0,
      localNewCount: 0,
      localOnlyCount: 0,
      newFiles: remoteFiles.map((f) => f.daPath),
      modified: [],
      outdated: [],
      conflicts: [],
      unchanged: [],
      deletedLocally: [],
      localNew: [],
      localOnly: [],
      syncedFolders,
    };
  }

  const manifestMap = new Map();
  for (const f of manifest.files || []) {
    manifestMap.set(f.daPath, f);
  }

  const newFiles = [];
  const modified = [];
  const outdated = [];
  const conflicts = [];
  const unchanged = [];
  const deletedLocally = [];

  const remoteSet = new Set();

  const checks = remoteFiles.map(async (remote) => {
    remoteSet.add(remote.daPath);
    const prev = manifestMap.get(remote.daPath);
    if (!prev) {
      newFiles.push(remote.daPath);
      return;
    }

    const remoteChanged = isRemoteChanged(prev.lastModified, remote.lastModified);

    const paths = syncPaths(destRoot, org, repo, remote.daPath);
    const { workingPath, originalPath } = paths;

    const workingMtime = await fileMtime(workingPath);
    if (!workingMtime) {
      deletedLocally.push(remote.daPath);
      return;
    }

    const origBuf = await safeReadFile(originalPath);
    const workBuf = await safeReadFile(workingPath);
    const localModified = origBuf && workBuf
      && !origBuf.equals(workBuf);

    if (localModified && remoteChanged) {
      conflicts.push(remote.daPath);
    } else if (localModified) {
      modified.push(remote.daPath);
    } else if (remoteChanged) {
      outdated.push(remote.daPath);
    } else {
      unchanged.push(remote.daPath);
    }
  });

  await Promise.all(checks);

  const localNew = [];
  const localOnly = [];
  const root = syncRoot(destRoot, org, repo);
  const scanDirs = (scopePaths && scopePaths.length > 0)
    ? scopePaths.map((sp) => {
      const segs = sp.split('/').filter(Boolean);
      return join(root, ...segs);
    })
    : [root];

  const scanResults = await Promise.all(
    scanDirs.map((d) => walkLocalDir(d)),
  );
  for (const localPath of scanResults.flat()) {
    const rel = relative(root, localPath);
    const daPath = `/${rel}`;
    if (!remoteSet.has(daPath)) {
      if (manifestMap.has(daPath)) {
        localOnly.push(daPath);
      } else if (isPushableLocalNewFile(daPath)) {
        localNew.push(daPath);
      }
    }
  }

  const syncedFolders = await collectSyncedFoldersFromAem(destRoot, org, repo);

  return {
    newCount: newFiles.length,
    modifiedCount: modified.length,
    outdatedCount: outdated.length,
    conflictCount: conflicts.length,
    unchangedCount: unchanged.length,
    deletedLocallyCount: deletedLocally.length,
    localNewCount: localNew.length,
    localOnlyCount: localOnly.length,
    newFiles,
    modified,
    outdated,
    conflicts,
    unchanged,
    deletedLocally,
    localNew,
    localOnly,
    syncedFolders,
  };
}

/**
 * @param {import('./da-api.js').DaClient} client
 * @param {string} org
 * @param {string} repo
 * @param {string[]} daPaths
 * @param {AbortSignal} [signal]
 * @returns {Promise<Map<string, { lastModified?: string, ext?: string }>>}
 */
async function fetchRemoteMetaForPaths(client, org, repo, daPaths, signal) {
  const folders = new Set(['/']);
  for (const daPath of daPaths) {
    const lastSlash = daPath.lastIndexOf('/');
    folders.add(lastSlash > 0 ? daPath.slice(0, lastSlash) : '/');
  }

  const remoteMeta = new Map();
  const folderList = [...folders];

  for (let i = 0; i < folderList.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      break;
    }
    const batch = folderList.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async (folder) => {
      const listing = await client.list(org, repo, folder);
      for (const entry of listing) {
        if (entry.ext === undefined) {
          continue; // eslint-disable-line no-continue
        }
        const entryDaPath = toDaPath(entry.path, org, repo);
        remoteMeta.set(entryDaPath, {
          lastModified: entry.lastModified,
          ext: entry.ext,
        });
      }
    }));
  }

  return remoteMeta;
}

/**
 * Compares manifest entries against remote list metadata to find pull candidates.
 *
 * @param {{
 *   destRoot: string,
 *   org: string,
 *   repo: string,
 *   manifestFiles: Array<{ daPath: string, lastModified?: string }>,
 *   remoteMeta: Map<string, { lastModified?: string, ext?: string }>,
 *   includeBinaries?: boolean,
 * }} options
 * @returns {Promise<{
 *   outdated: string[],
 *   conflicts: string[],
 *   deletedRemotely: string[],
 *   deletedConflicts: string[],
 *   files: Array<{ daPath: string, lastModified?: string, ext?: string, conflict: boolean }>,
 *   deletions: Array<{ daPath: string, conflict: boolean }>,
 * }>}
 */
export async function evaluatePullStatus({
  destRoot, org, repo, manifestFiles, remoteMeta, includeBinaries = true,
}) {
  const outdated = [];
  const conflicts = [];
  const deletedRemotely = [];
  const deletedConflicts = [];
  /** @type {Array<{ daPath: string, lastModified?: string, ext?: string, conflict: boolean }>} */
  const files = [];
  /** @type {Array<{ daPath: string, conflict: boolean }>} */
  const deletions = [];

  for (const prev of manifestFiles) {
    const remote = remoteMeta.get(prev.daPath);
    if (!remote) {
      const { workingPath, originalPath } = syncPaths(destRoot, org, repo, prev.daPath);
      const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
      const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
      const localModified = origBuf && workBuf && !origBuf.equals(workBuf);
      deletions.push({ daPath: prev.daPath, conflict: localModified });
      if (localModified) {
        deletedConflicts.push(prev.daPath);
      } else {
        deletedRemotely.push(prev.daPath);
      }
      continue; // eslint-disable-line no-continue
    }

    const ext = remote.ext || extname(prev.daPath).slice(1);
    if (!includeBinaries && isBinaryExtension(ext)) {
      continue; // eslint-disable-line no-continue
    }

    if (!isRemoteChanged(prev.lastModified, remote.lastModified)) {
      continue; // eslint-disable-line no-continue
    }

    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, prev.daPath);
    const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
    const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
    const localModified = origBuf && workBuf && !origBuf.equals(workBuf);

    const fileEntry = {
      daPath: prev.daPath,
      lastModified: remote.lastModified,
      ext,
      conflict: localModified,
    };
    files.push(fileEntry);

    if (localModified) {
      conflicts.push(prev.daPath);
    } else {
      outdated.push(prev.daPath);
    }
  }

  return {
    outdated, conflicts, deletedRemotely, deletedConflicts, files, deletions,
  };
}

/**
 * Finds files that changed on the remote since the last sync.
 *
 * @param {{
 *   client: import('./da-api.js').DaClient,
 *   org: string,
 *   repo: string,
 *   destRoot: string,
 *   includeBinaries?: boolean,
 *   signal?: AbortSignal,
 *   onProgress?: (data: { checked: number, total: number }) => void,
 * }} options
 */
/**
 * Parent directory of a daPath ('/' for a root-level file). Used to scope
 * newly-created remote files to directories we've already synced into.
 *
 * @param {string} daPath
 * @returns {string}
 */
function parentDaDir(daPath) {
  const idx = daPath.lastIndexOf('/');
  return idx <= 0 ? '/' : daPath.slice(0, idx);
}

const EMPTY_PULL_RESULT = {
  outdated: [], conflicts: [], deletedRemotely: [], deletedConflicts: [], files: [], deletions: [],
};

/**
 * @param {string|null} lastCheckedAt
 * @returns {object}
 */
function emptyPullStatus(lastCheckedAt = null) {
  return {
    ...EMPTY_PULL_RESULT,
    outdatedCount: 0,
    conflictCount: 0,
    deletedRemotelyCount: 0,
    deletedConflictsCount: 0,
    totalCount: 0,
    lastCheckedAt,
  };
}

/**
 * @param {object} result
 * @param {string|null} lastCheckedAt
 * @returns {object}
 */
function withPullCounts(result, lastCheckedAt) {
  return {
    ...result,
    outdatedCount: result.outdated.length,
    conflictCount: result.conflicts.length,
    deletedRemotelyCount: result.deletedRemotely.length,
    deletedConflictsCount: result.deletedConflicts.length,
    totalCount: result.files.length + result.deletions.length,
    lastCheckedAt,
  };
}

/**
 * Builds pull status from a set of source-log changes (helix6). Changed tracked
 * files become outdated/conflict; DELETEs become deletions; source-created
 * files under a synced directory are pulled as new (conflict if a local file
 * already occupies the path).
 *
 * @param {{
 *   destRoot: string, org: string, repo: string,
 *   manifestFiles: Array<{ daPath: string }>,
 *   changes: Map<string, { deleted: boolean, timestamp: number }>,
 *   includeBinaries?: boolean,
 * }} options
 */
async function evaluateLogPullStatus({
  destRoot, org, repo, manifestFiles, changes, includeBinaries = true,
}) {
  const outdated = [];
  const conflicts = [];
  const deletedRemotely = [];
  const deletedConflicts = [];
  const files = [];
  const deletions = [];

  const manifestByPath = new Map(manifestFiles.map((f) => [f.daPath, f]));
  const syncedDirs = new Set(manifestFiles.map((f) => parentDaDir(f.daPath)));

  for (const [daPath, change] of changes) {
    const inManifest = manifestByPath.has(daPath);
    const ext = extname(daPath).slice(1);
    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);

    if (change.deleted) {
      if (!inManifest) {
        continue; // eslint-disable-line no-continue
      }
      const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
      const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
      const localModified = Boolean(origBuf && workBuf && !origBuf.equals(workBuf));
      deletions.push({ daPath, conflict: localModified });
      (localModified ? deletedConflicts : deletedRemotely).push(daPath);
      continue; // eslint-disable-line no-continue
    }

    if (!includeBinaries && isBinaryExtension(ext)) {
      continue; // eslint-disable-line no-continue
    }

    const lastModified = new Date(change.timestamp).toISOString();

    if (inManifest) {
      const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
      const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
      const localModified = Boolean(origBuf && workBuf && !origBuf.equals(workBuf));
      files.push({
        daPath, lastModified, ext, conflict: localModified,
      });
      (localModified ? conflicts : outdated).push(daPath);
    } else {
      // Newly-created remote file: only pull it if it lands in a directory we
      // already sync. A local file already at that path is a conflict.
      if (!syncedDirs.has(parentDaDir(daPath))) {
        continue; // eslint-disable-line no-continue
      }
      const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
      const localConflict = Boolean(workBuf);
      files.push({
        daPath, lastModified, ext, conflict: localConflict,
      });
      (localConflict ? conflicts : outdated).push(daPath);
    }
  }

  return {
    outdated, conflicts, deletedRemotely, deletedConflicts, files, deletions,
  };
}

export async function checkPullStatus({
  client, org, repo, destRoot, includeBinaries = true, signal, onProgress, ref,
}) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath(destRoot, org, repo), 'utf8'));
  } catch {
    return emptyPullStatus(null);
  }

  const manifestFiles = manifest.files || [];
  if (manifestFiles.length === 0) {
    return emptyPullStatus(null);
  }

  const now = new Date().toISOString();
  const watermark = manifest.lastCheckedAt || manifest.syncedAt || null;
  const withinLogWindow = watermark
    && (Date.now() - Date.parse(watermark)) <= MAX_LOG_LOOKBACK_MS;

  // helix6: detect changes cheaply via the source audit log instead of a
  // per-file metadata sweep. Falls back to per-file when there's no usable
  // watermark or the gap is too large to page through.
  if (client.backend === API_BACKEND_AEM_API && withinLogWindow) {
    onProgress?.({ checked: 0, total: manifestFiles.length });
    const { entries, to } = await client.getLog(org, repo, { from: watermark, to: now });
    if (signal?.aborted) {
      return emptyPullStatus(null);
    }
    const changes = extractSourceChanges(entries, ref);
    const result = await evaluateLogPullStatus({
      destRoot, org, repo, manifestFiles, changes, includeBinaries,
    });
    onProgress?.({ checked: manifestFiles.length, total: manifestFiles.length });
    return withPullCounts(result, to);
  }

  onProgress?.({ checked: 0, total: manifestFiles.length });

  const daPaths = manifestFiles.map((f) => f.daPath);
  const remoteMeta = await fetchRemoteMetaForPaths(client, org, repo, daPaths, signal);

  if (signal?.aborted) {
    return emptyPullStatus(null);
  }

  const result = await evaluatePullStatus({
    destRoot,
    org,
    repo,
    manifestFiles,
    remoteMeta,
    includeBinaries,
  });

  onProgress?.({ checked: manifestFiles.length, total: manifestFiles.length });

  return withPullCounts(result, now);
}

/**
 * Removes selection entries that are redundant for a recursive listing/sync:
 * anything nested under another selected folder (already covered by that
 * folder's recursive walk) plus exact duplicates. Without this, overlapping
 * selections list/download the same subtrees repeatedly — hammering the admin
 * API (429s) and inflating progress counts.
 *
 * @template {{ daPath: string, isFolder?: boolean }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function pruneSelectionForListing(items) {
  const folderPaths = items.filter((i) => i.isFolder).map((i) => i.daPath);
  const isUnderSelectedFolder = (daPath) => folderPaths.some((folder) => {
    if (folder === daPath) {
      return false;
    }
    const prefix = folder === '/' ? '/' : `${folder}/`;
    return daPath.startsWith(prefix);
  });

  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item.daPath)) {
      continue; // eslint-disable-line no-continue
    }
    seen.add(item.daPath);
    if (isUnderSelectedFolder(item.daPath)) {
      continue; // eslint-disable-line no-continue
    }
    result.push(item);
  }
  return result;
}

/**
 * Recursively collects all files under a DA folder (up to CONCURRENCY parallel list calls).
 *
 * @param {import('./content-api-client.js').ContentApiClient} client
 * @param {string} org
 * @param {string} repo
 * @param {string} daPath
 * @param {boolean} includeBinaries
 * @param {AbortSignal} [signal]
 * @param {(data: { discovered: number }) => void} [onProgress]
 * @returns {Promise<Array<{ daPath: string, ext: string, lastModified?: string }>>}
 */
export async function collectFolder(
  client,
  org,
  repo,
  daPath,
  includeBinaries,
  signal,
  onProgress,
) {
  if (signal?.aborted) {
    return [];
  }

  /** @type {Array<{ daPath: string, ext: string, lastModified?: string }>} */
  const files = [];
  /** @type {string[]} */
  const folderQueue = [daPath];
  let nextFolderIndex = 0;
  let inFlight = 0;

  const reportProgress = () => {
    onProgress?.({ discovered: files.length });
  };

  const listOneFolder = async (folderPath) => {
    const raw = await client.list(org, repo, folderPath);
    /** @type {string[]} */
    const subfolders = [];
    for (const entry of raw) {
      if (signal?.aborted) {
        return subfolders;
      }
      const entryDaPath = toDaPath(entry.path, org, repo);
      if (entry.ext === undefined) {
        subfolders.push(entryDaPath);
      } else if (includeBinaries || !isBinaryExtension(entry.ext)) {
        files.push({
          daPath: entryDaPath,
          ext: entry.ext,
          lastModified: entry.lastModified,
        });
        reportProgress();
      }
    }
    return subfolders;
  };

  return new Promise((resolve, reject) => {
    /** @type {() => void} */
    let pump;

    const onFolderListed = (subfolders) => {
      folderQueue.push(...subfolders);
      inFlight -= 1;
      if (nextFolderIndex >= folderQueue.length && inFlight === 0) {
        resolve(files);
        return;
      }
      pump();
    };

    pump = () => {
      if (signal?.aborted) {
        resolve(files);
        return;
      }

      while (inFlight < CONCURRENCY && nextFolderIndex < folderQueue.length) {
        const folderPath = folderQueue[nextFolderIndex];
        nextFolderIndex += 1;
        inFlight += 1;
        listOneFolder(folderPath)
          .then(onFolderListed)
          .catch(reject);
      }

      if (folderQueue.length === 0 && inFlight === 0) {
        resolve(files);
      }
    };

    pump();
  });
}

/**
 * Downloads and writes a single file to both working and .aem paths.
 */
async function syncOneFile(client, org, repo, destRoot, file, mediaOrigin) {
  const result = await client.downloadRaw(org, repo, file.daPath);
  if (!result) {
    return null;
  }

  const { workingPath, originalPath } = syncPaths(destRoot, org, repo, file.daPath);
  const buf = Buffer.from(result.buffer);

  // The `.aem` original keeps the server's pristine bytes (relative ./media
  // refs) for diffing and upload; the editable working copy gets ./media
  // rewritten to absolute origin URLs so images resolve when opened locally.
  let workingBuf = buf;
  if (mediaOrigin && isTransformableHtml(file.daPath)) {
    const html = buf.toString('utf8');
    const transformed = toAbsoluteMedia(html, mediaOrigin, file.daPath);
    if (transformed !== html) {
      workingBuf = Buffer.from(transformed, 'utf8');
    }
  }

  await mkdir(dirname(workingPath), { recursive: true });
  await mkdir(dirname(originalPath), { recursive: true });
  await writeFile(workingPath, workingBuf);
  // Re-syncing overwrites an existing original that we previously locked; clear
  // the read-only bit first so the write succeeds, then re-apply it below.
  await makeWritable(originalPath);
  await writeFile(originalPath, buf);

  if (file.lastModified) {
    const mtime = new Date(file.lastModified);
    if (!Number.isNaN(mtime.getTime())) {
      await utimes(workingPath, mtime, mtime);
      await utimes(originalPath, mtime, mtime);
    }
  }

  await makeReadOnly(originalPath);

  return {
    daPath: file.daPath,
    contentType: result.contentType,
    lastModified: file.lastModified || null,
    size: buf.length,
  };
}

/**
 * @param {{
 *   client: import('./content-api-client.js').ContentApiClient,
 *   org: string,
 *   repo: string,
 *   items: Array<{daPath: string, isFolder: boolean, ext?: string, lastModified?: string}>,
 *   destRoot: string,
 *   includeBinaries: boolean,
 *   skipPaths?: Set<string>,
 *   onProgress: (data: object) => void,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<object>}
 */
export async function runSync({
  client, org, repo, items, destRoot, includeBinaries,
  excludeGlobs, skipPaths, onProgress, signal, precollectedFiles, mediaOrigin,
}) {
  onProgress({ phase: 'listing', completed: 0, total: 0 });

  // Reuse the listing already fetched by sync:check when available; otherwise
  // list everything (binaries included) once. Filters are applied in-memory
  // below so this matches the pre-download count exactly.
  let collected;
  if (precollectedFiles) {
    collected = precollectedFiles;
  } else {
    collected = [];
    for (const item of pruneSelectionForListing(items)) {
      if (signal?.aborted) {
        throw new Error('Sync cancelled');
      }
      if (item.isFolder) {
        const base = collected.length;
        // eslint-disable-next-line no-await-in-loop
        const children = await collectFolder(
          client,
          org,
          repo,
          item.daPath,
          true,
          signal,
          ({ discovered }) => {
            onProgress({
              phase: 'listing',
              discovered: base + discovered,
              total: 0,
            });
          },
        );
        collected.push(...children);
      } else {
        collected.push({
          daPath: item.daPath,
          ext: item.ext,
          lastModified: item.lastModified,
        });
      }
    }
  }

  // Apply the same in-memory filters as the pre-download check: drop binaries
  // (unless included) and anything matching the exclude globs.
  const includeFiltered = includeBinaries
    ? collected
    : collected.filter((f) => !isBinaryExtension(f.ext));
  const filesToSync = applyExcludeGlobs(includeFiltered, excludeGlobs);

  const prevManifestMap = new Map();
  try {
    const mPath = manifestPath(destRoot, org, repo);
    const prev = JSON.parse(await readFile(mPath, 'utf8'));
    for (const f of prev.files || []) {
      prevManifestMap.set(f.daPath, f);
    }
  } catch { /* no previous manifest */ }

  if (skipPaths && skipPaths.size > 0) {
    const before = filesToSync.length;
    for (let i = filesToSync.length - 1; i >= 0; i -= 1) {
      if (skipPaths.has(filesToSync[i].daPath)) {
        filesToSync.splice(i, 1);
      }
    }
    const skipped = before - filesToSync.length;
    if (skipped > 0) {
      onProgress({ phase: 'skipped', skipped });
    }
  }

  const total = filesToSync.length;
  onProgress({
    phase: 'downloading', completed: 0, total, current: '',
  });

  const downloadedPaths = new Set();
  let completed = 0;

  const newEntries = [];

  // Download in parallel batches of CONCURRENCY.
  for (let i = 0; i < total; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }

    const batch = filesToSync.slice(i, i + CONCURRENCY);
    const results = await Promise.all( // eslint-disable-line no-await-in-loop
      batch.map((file) => syncOneFile(client, org, repo, destRoot, file, mediaOrigin)),
    );

    for (const entry of results) {
      if (entry) {
        newEntries.push(entry);
        downloadedPaths.add(entry.daPath);
      }
    }

    completed += batch.length;
    const last = batch[batch.length - 1];
    onProgress({
      phase: 'downloading', completed, total, current: last.daPath,
    });
  }

  const manifestFiles = [];
  for (const [p, entry] of prevManifestMap) {
    if (!downloadedPaths.has(p)) {
      manifestFiles.push(entry);
    }
  }
  manifestFiles.push(...newEntries);

  const manifest = {
    org,
    repo,
    syncedAt: new Date().toISOString(),
    files: manifestFiles,
  };

  const mPath = manifestPath(destRoot, org, repo);
  await mkdir(dirname(mPath), { recursive: true });
  await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeAemGuardFiles(dirname(mPath));

  onProgress({
    phase: 'done', completed: total, total, current: '',
  });

  return manifest;
}

/**
 * Downloads remote updates for previously synced files and refreshes the manifest.
 *
 * @param {{
 *   client: import('./da-api.js').DaClient,
 *   org: string,
 *   repo: string,
 *   destRoot: string,
 *   files: Array<{ daPath: string, lastModified?: string, ext?: string }>,
 *   deletions?: string[],
 *   onProgress: (data: object) => void,
 *   signal?: AbortSignal,
 * }} options
 */
export async function runPull({
  client, org, repo, destRoot, files, deletions = [], onProgress, signal, mediaOrigin,
  lastCheckedAt,
}) {
  const total = files.length + deletions.length;
  onProgress({
    phase: 'downloading', completed: 0, total, current: '',
  });

  const prevManifestMap = new Map();
  let prevLastCheckedAt = null;
  try {
    const mPath = manifestPath(destRoot, org, repo);
    const prev = JSON.parse(await readFile(mPath, 'utf8'));
    prevLastCheckedAt = prev.lastCheckedAt || null;
    for (const f of prev.files || []) {
      prevManifestMap.set(f.daPath, f);
    }
  } catch { /* no previous manifest */ }

  let completed = 0;
  const newEntries = [];
  const downloadedPaths = new Set();

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new Error('Pull cancelled');
    }

    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all( // eslint-disable-line no-await-in-loop
      batch.map((file) => syncOneFile(client, org, repo, destRoot, file, mediaOrigin)),
    );

    for (const entry of results) {
      if (entry) {
        newEntries.push(entry);
        downloadedPaths.add(entry.daPath);
      }
    }

    completed += batch.length;
    const last = batch[batch.length - 1];
    onProgress({
      phase: 'downloading', completed, total, current: last.daPath,
    });
  }

  const deletedSet = new Set(deletions);
  for (let i = 0; i < deletions.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new Error('Pull cancelled');
    }

    const batch = deletions.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (daPath) => { // eslint-disable-line no-await-in-loop
      const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);
      await rm(workingPath, { force: true });
      await makeWritable(originalPath);
      await rm(originalPath, { force: true });
      prevManifestMap.delete(daPath);
    }));

    completed += batch.length;
    const last = batch[batch.length - 1];
    onProgress({
      phase: 'deleting', completed, total, current: last,
    });
  }

  const manifestFiles = [];
  for (const [p, entry] of prevManifestMap) {
    if (!downloadedPaths.has(p) && !deletedSet.has(p)) {
      manifestFiles.push(entry);
    }
  }
  manifestFiles.push(...newEntries);

  const manifest = {
    org,
    repo,
    syncedAt: new Date().toISOString(),
    lastCheckedAt: lastCheckedAt || prevLastCheckedAt || null,
    files: manifestFiles,
  };

  const mPath = manifestPath(destRoot, org, repo);
  await mkdir(dirname(mPath), { recursive: true });
  await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeAemGuardFiles(dirname(mPath));

  onProgress({
    phase: 'done', completed: total, total, current: '',
  });

  return { pulled: newEntries.length, deleted: deletions.length };
}

/**
 * Scans the local sync directory for pushable changes:
 * modified files, new files, and deleted files.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<{ modified: string[], localNew: string[], deleted: string[] }>}
 */
export async function checkPushStatus({ destRoot, org, repo }) {
  const mPath = manifestPath(destRoot, org, repo);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(mPath, 'utf8'));
  } catch {
    return { modified: [], localNew: [], deleted: [] };
  }

  const manifestMap = new Map();
  for (const f of manifest.files || []) {
    manifestMap.set(f.daPath, f);
  }

  const modified = [];
  const deleted = [];
  const root = syncRoot(destRoot, org, repo);

  for (const [daPath] of manifestMap) {
    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);
    const workBuf = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
    if (!workBuf) {
      deleted.push(daPath);
      continue; // eslint-disable-line no-continue
    }
    const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
    if (!origBuf) {
      modified.push(daPath);
      continue; // eslint-disable-line no-continue
    }
    // Normalize media refs to ./media on BOTH sides before comparing. The
    // working copy carries absolute media from the download rewrite, but the
    // server original may itself already use absolute same-origin media — so
    // reversing only the working side flagged untouched files as modified.
    if (isTransformableHtml(daPath)) {
      const normalizedWork = toRelativeMedia(workBuf.toString('utf8'), daPath);
      const normalizedOrig = toRelativeMedia(origBuf.toString('utf8'), daPath);
      if (normalizedWork !== normalizedOrig) {
        modified.push(daPath);
      }
    } else if (!origBuf.equals(workBuf)) {
      modified.push(daPath);
    }
  }

  const localFiles = await walkLocalDir(root);
  const localNew = [];
  for (const localPath of localFiles) {
    const rel = relative(root, localPath);
    const daPath = `/${rel}`;
    if (!manifestMap.has(daPath) && isPushableLocalNewFile(daPath)) {
      localNew.push(daPath);
    }
  }

  return { modified, localNew, deleted };
}

/**
 * Whether a connection has any locally synced content on disk (working copy,
 * `.aem` originals, or manifest). Used to decide the overview remove control:
 * a plain remove (×) when empty vs. a delete-content action (trash) when not.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<boolean>}
 */
export async function hasLocalContent({ destRoot, org, repo }) {
  if (!destRoot) {
    return false;
  }
  try {
    const entries = await readdir(syncRoot(destRoot, org, repo));
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Local-content summary for the overview list: whether any content is synced
 * and how many uncommitted local changes (modified + new + deleted) exist.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<{ hasContent: boolean, changeCount: number }>}
 */
export async function localContentSummary({ destRoot, org, repo }) {
  if (!(await hasLocalContent({ destRoot, org, repo }))) {
    return { hasContent: false, changeCount: 0 };
  }
  const { modified, localNew, deleted } = await checkPushStatus({ destRoot, org, repo });
  return {
    hasContent: true,
    changeCount: modified.length + localNew.length + deleted.length,
  };
}

/**
 * @typedef {{
 *   fileCount: number,
 *   syncedAt: string|null,
 *   modifiedCount: number|null,
 *   newCount: number|null,
 *   deletedCount: number|null,
 *   computedAt: string|null,
 * }} SyncSummary
 */

/**
 * Computes the local sync status for a connection from on-disk state (manifest
 * plus a working-vs-original comparison) — no network — and caches it to
 * `.aem/status.json` so it can be shown instantly next time. Returns null when
 * nothing has been synced yet.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<SyncSummary|null>}
 */
export async function computeSyncSummary({ destRoot, org, repo }) {
  if (!destRoot) {
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath(destRoot, org, repo), 'utf8'));
  } catch {
    return null;
  }

  const { modified, localNew, deleted } = await checkPushStatus({ destRoot, org, repo });
  const summary = {
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    syncedAt: manifest.syncedAt || null,
    lastCheckedAt: manifest.lastCheckedAt || null,
    modifiedCount: modified.length,
    newCount: localNew.length,
    deletedCount: deleted.length,
    computedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      statusCachePath(destRoot, org, repo),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Best-effort cache; a failed write just means the next read recomputes.
  }
  return summary;
}

/**
 * Fast, cached local sync status for instant display. Prefers the cached
 * `.aem/status.json`; if it is missing, falls back to the manifest for the
 * cheap fields (file count + last-synced) with modified counts left null so
 * the caller can fill them in via {@link computeSyncSummary}. Returns null when
 * nothing has been synced.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<SyncSummary|null>}
 */
export async function readCachedSyncSummary({ destRoot, org, repo }) {
  if (!destRoot) {
    return null;
  }
  try {
    return JSON.parse(await readFile(statusCachePath(destRoot, org, repo), 'utf8'));
  } catch {
    // No cache yet — fall back to the manifest below.
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath(destRoot, org, repo), 'utf8'));
    return {
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
      syncedAt: manifest.syncedAt || null,
      lastCheckedAt: manifest.lastCheckedAt || null,
      modifiedCount: null,
      newCount: null,
      deletedCount: null,
      computedAt: null,
    };
  } catch {
    return null;
  }
}

/**
 * Records that a "check for updates" ran now, even when it found nothing to
 * pull, by stamping `lastCheckedAt` on the manifest (and refreshing the cached
 * summary that drives the header's "Updated …" label). No-op without a manifest.
 *
 * @param {{ destRoot: string, org: string, repo: string, lastCheckedAt: string }} options
 * @returns {Promise<object|null>} the refreshed summary, or null
 */
export async function touchPullCheckedAt({
  destRoot, org, repo, lastCheckedAt,
}) {
  const mPath = manifestPath(destRoot, org, repo);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(mPath, 'utf8'));
  } catch {
    return null;
  }
  manifest.lastCheckedAt = lastCheckedAt || new Date().toISOString();
  await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeAemGuardFiles(dirname(mPath));
  return computeSyncSummary({ destRoot, org, repo });
}

/**
 * Removes a connection's entire local sync directory (working copy, `.aem`
 * originals, and manifest). No-op when nothing is synced.
 *
 * @param {{ destRoot: string, org: string, repo: string }} options
 * @returns {Promise<void>}
 */
export async function deleteLocalContent({ destRoot, org, repo }) {
  if (!destRoot) {
    return;
  }
  // Our pristine originals are read-only; clear that first so the recursive
  // delete isn't blocked (notably on Windows, where read-only can't unlink).
  await restoreTreeWritable(join(destRoot, org, repo, '.aem'));
  await rm(syncRoot(destRoot, org, repo), { recursive: true, force: true });
}

/**
 * @param {string} targetPath
 * @param {{ lastModified?: string }|undefined} manifestEntry
 * @param {string} fallbackMtimePath
 */
async function restoreWorkingMtime(targetPath, manifestEntry, fallbackMtimePath) {
  let mtime = null;
  if (manifestEntry?.lastModified) {
    const parsed = new Date(manifestEntry.lastModified);
    if (!Number.isNaN(parsed.getTime())) {
      mtime = parsed;
    }
  }
  if (!mtime) {
    try {
      mtime = (await stat(fallbackMtimePath)).mtime;
    } catch {
      return;
    }
  }
  await utimes(targetPath, mtime, mtime);
}

/**
 * Restores selected local changes from `.aem` originals (or removes local-only files).
 *
 * @param {{
 *   destRoot: string,
 *   org: string,
 *   repo: string,
 *   files: Array<{ daPath: string, status: string }>,
 *   onProgress: (data: object) => void,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{ reverted: number }>}
 */
export async function runRevert({
  destRoot, org, repo, files, onProgress, signal, mediaOrigin,
}) {
  const manifestMap = new Map();
  try {
    const manifest = JSON.parse(await readFile(manifestPath(destRoot, org, repo), 'utf8'));
    for (const f of manifest.files || []) {
      manifestMap.set(f.daPath, f);
    }
  } catch { /* no manifest */ }

  const total = files.length;
  let completed = 0;

  onProgress({
    phase: 'reverting', completed: 0, total, current: '',
  });

  for (const file of files) {
    if (signal?.aborted) {
      throw new Error('Revert cancelled');
    }

    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, file.daPath);

    if (file.status === 'new') {
      await rm(workingPath, { force: true }); // eslint-disable-line no-await-in-loop
    } else {
      const origBuf = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
      if (!origBuf) {
        throw new Error(`Missing original for ${file.daPath}`);
      }
      await mkdir(dirname(workingPath), { recursive: true }); // eslint-disable-line
      await copyFile(originalPath, workingPath); // eslint-disable-line no-await-in-loop
      // Restore the working copy to the same absolute-media form a fresh
      // download produces, not the pristine ./media original.
      if (mediaOrigin && isTransformableHtml(file.daPath)) {
        const origHtml = origBuf.toString('utf8');
        const transformed = toAbsoluteMedia(origHtml, mediaOrigin, file.daPath);
        if (transformed !== origHtml) {
          await writeFile(workingPath, Buffer.from(transformed, 'utf8')); // eslint-disable-line no-await-in-loop
        }
      }
      await restoreWorkingMtime( // eslint-disable-line no-await-in-loop
        workingPath,
        manifestMap.get(file.daPath),
        originalPath,
      );
    }

    completed += 1;
    onProgress({
      phase: 'reverting', completed, total, current: file.daPath,
    });
  }

  onProgress({
    phase: 'done', completed: total, total, current: '',
  });

  return { reverted: total };
}

/**
 * Pushes local changes (modified, new, deleted) to the remote DA.
 *
 * @param {{
 *   client: import('./content-api-client.js').ContentApiClient,
 *   org: string,
 *   repo: string,
 *   destRoot: string,
 *   filesToPush: string[],
 *   filesToDelete: string[],
 *   onProgress: (data: object) => void,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{ uploaded: number, deleted: number }>}
 */
export async function runPush({
  client, org, repo, destRoot, filesToPush, filesToDelete,
  onProgress, signal, mediaHosts = [],
}) {
  const total = filesToPush.length + filesToDelete.length;
  let completed = 0;

  onProgress({
    phase: 'uploading', completed: 0, total, current: '',
  });

  for (let i = 0; i < filesToPush.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new Error('Push cancelled');
    }
    const batch = filesToPush.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (daPath) => { // eslint-disable-line no-await-in-loop
      const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);
      const workBuf = await readFile(workingPath);
      const mime = contentTypeForUpload(daPath);

      // The working copy stores absolute media URLs for local viewing; send the
      // pristine ./media relative refs back to the source on upload.
      const html = isTransformableHtml(daPath) ? toRelativeMedia(workBuf.toString('utf8'), daPath) : null;
      const uploadBuf = html !== null ? Buffer.from(html, 'utf8') : workBuf;

      // helix6 interns external images on POST; PUT replaces as-is. For HTML on
      // that backend, POST when the doc references any non-media-bus image so
      // the server pulls it in; otherwise PUT (with the 400 fallback as a net).
      const preferPost = client.backend === API_BACKEND_AEM_API && mime === 'text/html'
        ? htmlNeedsMediaInterning(html ?? '', mediaHosts)
        : false;
      await client.uploadSource(org, repo, daPath, uploadBuf, mime, { preferPost });

      // The new pristine original is exactly what the server now has.
      await mkdir(dirname(originalPath), { recursive: true });
      await makeWritable(originalPath);
      if (html !== null) {
        await writeFile(originalPath, uploadBuf);
      } else {
        await copyFile(workingPath, originalPath);
      }
      await makeReadOnly(originalPath);
    }));
    completed += batch.length;
    const last = batch[batch.length - 1];
    onProgress({
      phase: 'uploading', completed, total, current: last,
    });
  }

  for (let i = 0; i < filesToDelete.length; i += CONCURRENCY) {
    if (signal?.aborted) {
      throw new Error('Push cancelled');
    }
    const batch = filesToDelete.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (daPath) => { // eslint-disable-line no-await-in-loop
      await client.deleteSource(org, repo, daPath);
    }));
    completed += batch.length;
    const last = batch[batch.length - 1];
    onProgress({
      phase: 'deleting', completed, total, current: last,
    });
  }

  const mPath = manifestPath(destRoot, org, repo);
  const manifestMap = new Map();
  try {
    const prev = JSON.parse(await readFile(mPath, 'utf8'));
    for (const f of prev.files || []) {
      manifestMap.set(f.daPath, f);
    }
  } catch { /* no manifest */ }

  const deleteSet = new Set(filesToDelete);
  for (const dp of deleteSet) {
    manifestMap.delete(dp);
  }

  const parentFolders = new Set();
  for (const daPath of filesToPush) {
    const lastSlash = daPath.lastIndexOf('/');
    parentFolders.add(lastSlash > 0 ? daPath.slice(0, lastSlash) : '/');
  }
  const remoteMeta = new Map();
  for (const folder of parentFolders) {
    try {
      const listing = await client.list(org, repo, folder); // eslint-disable-line no-await-in-loop
      for (const entry of listing) {
        const entryDaPath = toDaPath(entry.path, org, repo);
        if (entry.lastModified) {
          remoteMeta.set(entryDaPath, entry.lastModified);
        }
      }
    } catch { /* best effort */ }
  }

  for (const daPath of filesToPush) {
    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);
    const s = await stat(workingPath); // eslint-disable-line no-await-in-loop
    const serverModified = remoteMeta.get(daPath) || new Date().toISOString();
    manifestMap.set(daPath, {
      daPath,
      contentType: contentTypeForUpload(daPath),
      lastModified: serverModified,
      size: s.size,
    });

    const mtime = new Date(serverModified);
    if (!Number.isNaN(mtime.getTime())) {
      await utimes(workingPath, mtime, mtime); // eslint-disable-line no-await-in-loop
      await makeWritable(originalPath); // eslint-disable-line no-await-in-loop
      await utimes(originalPath, mtime, mtime); // eslint-disable-line no-await-in-loop
      await makeReadOnly(originalPath); // eslint-disable-line no-await-in-loop
    }
  }

  const manifest = {
    org,
    repo,
    syncedAt: new Date().toISOString(),
    files: [...manifestMap.values()],
  };
  await mkdir(dirname(mPath), { recursive: true });
  await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeAemGuardFiles(dirname(mPath));

  onProgress({
    phase: 'done', completed: total, total, current: '',
  });

  return { uploaded: filesToPush.length, deleted: filesToDelete.length };
}

const HTML_EXTS = new Set(['html', 'htm']);

/**
 * Pretty-prints file content if it is HTML; otherwise returns as-is.
 * @param {string} content
 * @param {string} daPath
 * @returns {string}
 */
function prettify(content, daPath) {
  const ext = extname(daPath).slice(1).toLowerCase();
  if (HTML_EXTS.has(ext)) {
    return prettyPrintHtml(content);
  }
  if (ext === 'json') {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

/**
 * Computes diffs for all pushable changes.
 *
 * @param {{
 *   destRoot: string,
 *   org: string,
 *   repo: string,
 *   modified: string[],
 *   localNew: string[],
 *   deleted: string[],
 * }} options
 * @returns {Promise<Array<{
 *   daPath: string,
 *   status: string,
 *   additions: number,
 *   deletions: number,
 *   hunks: Array,
 * }>>}
 */
export async function computePushDiffs({
  destRoot, org, repo, modified, localNew, deleted,
}) {
  const results = [];

  for (const daPath of modified) {
    const { workingPath, originalPath } = syncPaths(destRoot, org, repo, daPath);
    const origRaw = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
    const workRaw = await safeReadFile(workingPath); // eslint-disable-line no-await-in-loop
    const origSource = origRaw ? origRaw.toString('utf8') : '';
    const workSource = workRaw ? workRaw.toString('utf8') : '';
    // Normalize media refs to ./media on BOTH sides so neither the download's
    // absolute-media rewrite nor already-absolute server media shows as an edit.
    const isHtml = isTransformableHtml(daPath);
    const origText = prettify(isHtml ? toRelativeMedia(origSource, daPath) : origSource, daPath);
    const workText = prettify(isHtml ? toRelativeMedia(workSource, daPath) : workSource, daPath);
    const oldLines = origText.split('\n');
    const newLines = workText.split('\n');
    const edits = myersDiff(oldLines, newLines);
    const hunks = buildHunks(edits);
    const additions = edits.filter((e) => e.type === 'insert').length;
    const deletions = edits.filter((e) => e.type === 'delete').length;
    results.push({
      daPath, status: 'modified', additions, deletions, hunks,
    });
  }

  for (const daPath of localNew) {
    const root = syncRoot(destRoot, org, repo);
    const segs = daPath.split('/').filter(Boolean);
    const filePath = join(root, ...segs);
    const raw = await safeReadFile(filePath); // eslint-disable-line no-await-in-loop
    const text = prettify(raw ? raw.toString('utf8') : '', daPath);
    const newLines = text.split('\n');
    const edits = myersDiff([], newLines);
    const hunks = buildHunks(edits);
    results.push({
      daPath, status: 'new', additions: newLines.length, deletions: 0, hunks,
    });
  }

  for (const daPath of deleted) {
    const { originalPath } = syncPaths(destRoot, org, repo, daPath);
    const raw = await safeReadFile(originalPath); // eslint-disable-line no-await-in-loop
    const text = prettify(raw ? raw.toString('utf8') : '', daPath);
    const oldLines = text.split('\n');
    const edits = myersDiff(oldLines, []);
    const hunks = buildHunks(edits);
    results.push({
      daPath, status: 'deleted', additions: 0, deletions: oldLines.length, hunks,
    });
  }

  return results;
}
