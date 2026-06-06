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
  mkdir, readdir, readFile, stat, writeFile, utimes, copyFile,
} from 'node:fs/promises';
import {
  join, dirname, relative, extname,
} from 'node:path';
import { toDaPath } from './aem-page-url.js';
import { prettyPrintHtml } from './pretty-print.js';
import { myersDiff, buildHunks } from './diff.js';

const TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'json', 'css', 'js', 'mjs', 'xml', 'txt', 'md',
  'svg', 'yaml', 'yml', 'csv', 'tsv',
]);

const CONCURRENCY = 10;

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

    const hasTimestamps = remote.lastModified && prev.lastModified;
    const remoteChanged = hasTimestamps
      ? String(remote.lastModified) !== String(prev.lastModified)
      : remote.lastModified && !prev.lastModified;

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
      } else {
        localNew.push(daPath);
      }
    }
  }

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
  };
}

/**
 * Recursively collects all files under a DA folder.
 */
export async function collectFolder(client, org, repo, daPath, includeBinaries, signal) {
  if (signal?.aborted) {
    return [];
  }
  const raw = await client.list(org, repo, daPath);
  const files = [];

  for (const entry of raw) {
    if (signal?.aborted) {
      return files;
    }
    const entryDaPath = toDaPath(entry.path, org, repo);
    const isFolder = entry.ext === undefined;

    if (isFolder) {
      // eslint-disable-next-line no-await-in-loop
      const children = await collectFolder(client, org, repo, entryDaPath, includeBinaries, signal);
      files.push(...children);
    } else {
      if (!includeBinaries && isBinaryExtension(entry.ext)) {
        continue; // eslint-disable-line no-continue
      }
      files.push({
        daPath: entryDaPath,
        ext: entry.ext,
        lastModified: entry.lastModified,
      });
    }
  }

  return files;
}

/**
 * Downloads and writes a single file to both working and .aem paths.
 */
async function syncOneFile(client, org, repo, destRoot, file) {
  const result = await client.downloadRaw(org, repo, file.daPath);
  if (!result) {
    return null;
  }

  const { workingPath, originalPath } = syncPaths(destRoot, org, repo, file.daPath);
  const buf = Buffer.from(result.buffer);

  await mkdir(dirname(workingPath), { recursive: true });
  await mkdir(dirname(originalPath), { recursive: true });
  await writeFile(workingPath, buf);
  await writeFile(originalPath, buf);

  if (file.lastModified) {
    const mtime = new Date(file.lastModified);
    if (!Number.isNaN(mtime.getTime())) {
      await utimes(workingPath, mtime, mtime);
      await utimes(originalPath, mtime, mtime);
    }
  }

  return {
    daPath: file.daPath,
    contentType: result.contentType,
    lastModified: file.lastModified || null,
    size: buf.length,
  };
}

/**
 * @param {{
 *   client: import('./da-api.js').DaClient,
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
  skipPaths, onProgress, signal,
}) {
  onProgress({ phase: 'listing', completed: 0, total: 0 });

  const filesToSync = [];
  for (const item of items) {
    if (signal?.aborted) {
      throw new Error('Sync cancelled');
    }
    if (item.isFolder) {
      // eslint-disable-next-line no-await-in-loop
      const children = await collectFolder(client, org, repo, item.daPath, includeBinaries, signal);
      filesToSync.push(...children);
    } else {
      if (!includeBinaries && isBinaryExtension(item.ext)) {
        continue; // eslint-disable-line no-continue
      }
      filesToSync.push({
        daPath: item.daPath,
        ext: item.ext,
        lastModified: item.lastModified,
      });
    }
  }

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
      batch.map((file) => syncOneFile(client, org, repo, destRoot, file)),
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

  onProgress({
    phase: 'done', completed: total, total, current: '',
  });

  return manifest;
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
    if (origBuf && !origBuf.equals(workBuf)) {
      modified.push(daPath);
    }
  }

  const localFiles = await walkLocalDir(root);
  const localNew = [];
  for (const localPath of localFiles) {
    const rel = relative(root, localPath);
    const daPath = `/${rel}`;
    if (!manifestMap.has(daPath)) {
      localNew.push(daPath);
    }
  }

  return { modified, localNew, deleted };
}

const MIME_BY_EXT = {
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/markdown',
  svg: 'image/svg+xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

function guessMime(daPath) {
  const dot = daPath.lastIndexOf('.');
  if (dot < 0) {
    return 'application/octet-stream';
  }
  const ext = daPath.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * Pushes local changes (modified, new, deleted) to the remote DA.
 *
 * @param {{
 *   client: import('./da-api.js').DaClient,
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
  onProgress, signal,
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
      const buf = await readFile(workingPath);
      const mime = guessMime(daPath);
      await client.uploadSource(org, repo, daPath, buf, mime);

      await mkdir(dirname(originalPath), { recursive: true });
      await copyFile(workingPath, originalPath);
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
      contentType: guessMime(daPath),
      lastModified: serverModified,
      size: s.size,
    });

    const mtime = new Date(serverModified);
    if (!Number.isNaN(mtime.getTime())) {
      await utimes(workingPath, mtime, mtime); // eslint-disable-line no-await-in-loop
      await utimes(originalPath, mtime, mtime); // eslint-disable-line no-await-in-loop
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
    const origText = prettify(origRaw ? origRaw.toString('utf8') : '', daPath);
    const workText = prettify(workRaw ? workRaw.toString('utf8') : '', daPath);
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
