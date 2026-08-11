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
 * `content` — a command-line interface over the most common AEM Desktop
 * operations (list sites, download, check for updates, upload). It shares the
 * desktop app's stored sites and sign-in: point it at the app's user-data
 * directory via `AEM_DESKTOP_USER_DATA` (the "Install CLI" launcher sets this),
 * otherwise it falls back to Electron's default per-platform location.
 *
 * Run under the bundled Electron binary in Node mode (`ELECTRON_RUN_AS_NODE=1`)
 * or under a plain Node 20+; it never touches Electron APIs.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { loadSites } from '../main/site-store.js';
import { loadSyncFolder } from '../main/sync-folder-store.js';
import { ContentApiClient } from '../main/content-api-client.js';
import { resolveStoredAccessToken } from '../main/da-session.js';
import { getAuthStatus, DA_TOKEN_FILENAME } from '../main/da-auth.js';
import { withRequestLogging } from '../main/http-log.js';
import { DA_UNAUTHORIZED_MESSAGE } from '../main/content-api-shared.js';
import {
  runSync, checkPullStatus, runPull, checkPushStatus, runPush,
  readCachedSyncSummary, syncRoot,
} from '../main/da-sync.js';
import { mediaOriginFor } from '../main/media-path-transform.js';
import { deriveSiteHosts } from '../main/media-references.js';
import {
  parseArgs, resolveSite, siteLabel, pathsToSyncItems,
} from './cli-lib.js';

// Store filenames. DA_TOKEN_FILENAME is exported by da-auth.js; these two are
// defined inline in src/main/index.js — keep them in sync with it.
const SITES_FILENAME = 'sites.json';
const SYNC_FOLDER_FILENAME = 'sync-folder.json';

/**
 * The app's user-data directory: the env var set by the installed launcher, or
 * Electron's default location for this platform (app name "AEM Desktop").
 *
 * @returns {string}
 */
function resolveUserDataDir() {
  const fromEnv = process.env.AEM_DESKTOP_USER_DATA;
  if (fromEnv) {
    return fromEnv;
  }
  const appName = 'AEM Desktop';
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), appName);
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), appName);
}

const userData = resolveUserDataDir();
const sitesFile = join(userData, SITES_FILENAME);
const syncFolderFile = join(userData, SYNC_FOLDER_FILENAME);
const tokenFile = join(userData, DA_TOKEN_FILENAME);

/**
 * Builds an authenticated content-API client for a site, or throws an
 * unauthorized error routed to a friendly message by {@link run}.
 *
 * @param {{ apiBackend?: string }} site
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<ContentApiClient>}
 */
async function makeClient(site, { verbose = false } = {}) {
  const token = await resolveStoredAccessToken(tokenFile);
  let fetchImpl = globalThis.fetch;
  if (verbose) {
    fetchImpl = withRequestLogging(fetchImpl, {
      logger: { info: (m) => console.error(m), warn: (m) => console.error(m) },
      enabled: true,
    });
  }
  return new ContentApiClient(token, site.apiBackend, fetchImpl);
}

/**
 * Resolves the local folder for downloads/updates/uploads: `--folder` wins,
 * else the folder configured in the app. Throws when neither is available.
 *
 * @param {Record<string, string|boolean>} flags
 * @returns {Promise<string>}
 */
async function resolveDestFolder(flags) {
  if (typeof flags.folder === 'string' && flags.folder) {
    return flags.folder;
  }
  const stored = await loadSyncFolder(syncFolderFile);
  if (!stored) {
    throw new Error('No local folder is set. Choose one in AEM Desktop, or pass --folder <path>.');
  }
  return stored;
}

/** Writes a transient progress line to stderr when attached to a terminal. */
function progress(text) {
  if (process.stderr.isTTY) {
    process.stderr.write(`\r${text}\x1b[K`);
  }
}

/** Clears the transient progress line. */
function progressEnd() {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\x1b[K');
  }
}

/**
 * Yes/no confirmation for outward-facing actions (uploading to the remote).
 * Non-interactive callers must pass `--yes`.
 *
 * @param {string} question
 * @param {boolean} assumeYes
 * @returns {Promise<boolean>}
 */
async function confirm(question, assumeYes) {
  if (assumeYes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to proceed without confirmation. Re-run with --yes to confirm.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

const USAGE = `content — AEM Desktop command-line interface

Usage:
  content sites                       List configured sites
  content status                      Show sign-in, local folder, and site status
  content download [site] [paths...]  Download content to the local folder
  content update   [site]             Check for updates and apply them (pull)
  content upload   [site]             Upload local changes to the site (push)

Site selector: org/repo, a 1-based index from "content sites", an id, or a
bare repo name. Omit it when only one site is configured.

Options:
  --folder <path>        Override the local folder for this command
  --include-binaries     Include images/binaries when downloading
  --exclude <globs>      Comma-separated globs to skip, e.g. "*/drafts/*,*/recipes/*"
  --dry-run              For update/upload: show what would change, don't apply
  -y, --yes              Skip the upload confirmation prompt
  -v, --verbose          Log HTTP requests to stderr
  -h, --help             Show this help
`;

/**
 * Loads sites plus a cheap cached local summary for each.
 *
 * @param {string|null} folder
 * @returns {Promise<{ site: object, summary: object|null }[]>}
 */
async function loadSiteRows(folder) {
  const sites = await loadSites(sitesFile);
  return Promise.all(sites.map(async (site) => ({
    site,
    summary: folder
      ? await readCachedSyncSummary({ destRoot: folder, org: site.org, repo: site.repo })
      : null,
  })));
}

/**
 * @param {object|null} summary
 * @returns {string}
 */
function summaryLabel(summary) {
  if (!summary) {
    return 'not downloaded';
  }
  const parts = [`${summary.fileCount} file${summary.fileCount === 1 ? '' : 's'}`];
  const changes = [];
  if (summary.modifiedCount) changes.push(`${summary.modifiedCount} modified`);
  if (summary.newCount) changes.push(`${summary.newCount} new`);
  if (summary.deletedCount) changes.push(`${summary.deletedCount} deleted`);
  if (changes.length) {
    parts.push(`(${changes.join(', ')})`);
  }
  return parts.join(' ');
}

async function cmdSites() {
  const folder = await loadSyncFolder(syncFolderFile);
  const rows = await loadSiteRows(folder);
  if (rows.length === 0) {
    console.log('No sites configured. Add one in AEM Desktop.');
    return;
  }
  rows.forEach(({ site, summary }, i) => {
    const backend = site.apiBackend === 'aem-api' ? ' [api.aem.live]' : '';
    console.log(`${i + 1}. ${siteLabel(site)} (${site.branch})${backend}`);
    console.log(`     ${summaryLabel(summary)}`);
  });
}

async function cmdStatus() {
  const auth = await getAuthStatus(tokenFile);
  if (auth.authenticated) {
    const exp = auth.expiresAt ? ` (expires ${new Date(auth.expiresAt).toLocaleString()})` : '';
    console.log(`Signed in to AEM${exp}`);
  } else {
    console.log('Not signed in. Open AEM Desktop and sign in.');
  }
  const folder = await loadSyncFolder(syncFolderFile);
  console.log(`Local folder: ${folder || '(none set)'}`);
  console.log('');
  await cmdSites();
}

async function cmdDownload(selector, paths, flags) {
  const sites = await loadSites(sitesFile);
  const site = resolveSite(sites, selector);
  const destFolder = await resolveDestFolder(flags);
  const items = pathsToSyncItems(paths);
  const includeBinaries = flags['include-binaries'] === true;
  const excludeGlobs = typeof flags.exclude === 'string' ? flags.exclude : undefined;
  const client = await makeClient(site, { verbose: flags.v === true || flags.verbose === true });

  console.error(`Downloading ${siteLabel(site)} → ${destFolder}`);
  const manifest = await runSync({
    client,
    org: site.org,
    repo: site.repo,
    items,
    destRoot: destFolder,
    includeBinaries,
    excludeGlobs,
    mediaOrigin: mediaOriginFor(site.previewUrl),
    onProgress: (data) => {
      if (data.phase === 'listing') {
        progress(`Listing… ${data.discovered ?? 0} file(s)`);
      } else if (data.phase === 'downloading') {
        progress(`Downloading ${data.completed}/${data.total}…`);
      }
    },
  });
  progressEnd();

  const dest = syncRoot(destFolder, site.org, site.repo);
  console.log(`Downloaded ${manifest.files.length} file(s) to ${dest}`);
}

async function cmdUpdate(selector, flags) {
  const sites = await loadSites(sitesFile);
  const site = resolveSite(sites, selector);
  const destFolder = await resolveDestFolder(flags);
  const client = await makeClient(site, { verbose: flags.v === true || flags.verbose === true });

  console.error(`Checking ${siteLabel(site)} for updates…`);
  const status = await checkPullStatus({
    client,
    org: site.org,
    repo: site.repo,
    destRoot: destFolder,
    onProgress: (p) => progress(`Checking ${p.checked}/${p.total}…`),
  });
  progressEnd();

  if (status.totalCount === 0) {
    console.log('Already up to date.');
    return;
  }

  console.log(`${status.outdatedCount} updated, ${status.deletedRemotelyCount} deleted remotely`
    + `${status.conflictCount ? `, ${status.conflictCount} conflict(s) (skipped)` : ''}`);

  if (flags['dry-run'] === true) {
    console.log('Dry run — nothing applied.');
    return;
  }

  const result = await runPull({
    client,
    org: site.org,
    repo: site.repo,
    destRoot: destFolder,
    files: status.files,
    deletions: status.deletions,
    mediaOrigin: mediaOriginFor(site.previewUrl),
    onProgress: (data) => progress(`Applying ${data.completed}/${data.total}…`),
  });
  progressEnd();
  console.log(`Applied updates to ${syncRoot(destFolder, site.org, site.repo)}`);
  if (result && typeof result.deleted === 'number') {
    console.log(`  ${result.downloaded ?? status.files.length} downloaded, ${result.deleted} deleted`);
  }
}

async function cmdUpload(selector, flags) {
  const sites = await loadSites(sitesFile);
  const site = resolveSite(sites, selector);
  const destFolder = await resolveDestFolder(flags);

  const { modified, localNew, deleted } = await checkPushStatus({
    destRoot: destFolder,
    org: site.org,
    repo: site.repo,
  });
  const filesToPush = [...modified, ...localNew];
  const filesToDelete = deleted;

  if (filesToPush.length === 0 && filesToDelete.length === 0) {
    console.log('Nothing to upload.');
    return;
  }

  console.log(`Upload to ${siteLabel(site)}: ${modified.length} modified, `
    + `${localNew.length} new, ${filesToDelete.length} deleted`);

  if (flags['dry-run'] === true) {
    console.log('Dry run — nothing uploaded.');
    return;
  }

  // Uploading changes remote content, so require explicit confirmation.
  const ok = await confirm(
    `Upload ${filesToPush.length + filesToDelete.length} change(s) to ${siteLabel(site)}?`,
    flags.y === true || flags.yes === true,
  );
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  const client = await makeClient(site, { verbose: flags.v === true || flags.verbose === true });
  await runPush({
    client,
    org: site.org,
    repo: site.repo,
    destRoot: destFolder,
    filesToPush,
    filesToDelete,
    mediaHosts: deriveSiteHosts(site.previewUrl),
    onProgress: (data) => progress(`${data.phase} ${data.completed}/${data.total}…`),
  });
  progressEnd();
  console.log('Upload complete.');
}

async function run(argv) {
  const { command, positionals, flags } = parseArgs(argv, {
    valueFlags: ['folder', 'exclude'],
  });

  if (flags.h === true || flags.help === true || command === 'help' || !command) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case 'sites':
      await cmdSites();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'download':
      await cmdDownload(positionals[0], positionals.slice(1), flags);
      break;
    case 'update':
      await cmdUpdate(positionals[0], flags);
      break;
    case 'upload':
      await cmdUpload(positionals[0], flags);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 2;
  }
}

run(process.argv.slice(2)).catch((err) => {
  const message = err?.message || String(err);
  if (message.includes(DA_UNAUTHORIZED_MESSAGE)) {
    console.error('Not signed in (or session expired). Open AEM Desktop and sign in, then retry.');
  } else {
    console.error(`error: ${message}`);
  }
  process.exitCode = 1;
});
