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
  app, BrowserWindow, dialog, ipcMain, session, shell,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { createWindowOptions } from './window-options.js';
import { initAutoUpdater } from './updater.js';
import { screenshotFilename } from './dev-config.js';
import { toDaPath } from './aem-page-url.js';
import {
  API_BACKEND_AEM_API,
  API_BACKEND_DA_LIVE,
  isDaUnauthorizedError,
} from './content-api-shared.js';
import { ContentApiClient } from './content-api-client.js';
import { HttpRequestError } from './http-request-error.js';
import {
  DA_TOKEN_FILENAME, getAuthStatus, getValidToken, loadStoredToken,
} from './da-auth.js';
import {
  describeTokenDiagnostics,
  invalidateDaSession,
  resolveStoredAccessToken,
} from './da-session.js';
import {
  isSiteTokenExpired,
  loadSiteTokens,
  saveSiteTokens,
  siteTokenKey,
  SITE_TOKEN_FILENAME,
} from './site-token-store.js';
import {
  adminBaseForApiBackend,
  parsePreviewRef,
} from './preview-login-url.js';
import { openPreviewLogin, PREVIEW_LOGIN_PARTITION } from './preview-login.js';
import {
  addSiteFromUrl, findSite, loadSites, removeSite, saveSites,
} from './site-store.js';
import { loadSyncFolder, saveSyncFolder } from './sync-folder-store.js';
import { formatContentForDisplay } from './content-format.js';
import { parseDocumentHtml } from './document-view-html.js';
import { diffDocumentHtml } from './document-view-diff.js';
import {
  initContentDaLiveAuth,
  PREVIEW_WEBVIEW_PARTITION,
} from './content-da-live-auth.js';
import { buildPreviewUrl, buildProxyPreviewUrl } from './preview-url.js';
import { startPreviewServer } from './preview-server.js';
import { createPreviewServerRegistry } from './preview-server-registry.js';
import { createHeadHtmlCache } from './head-html.js';
import { createMetadataJsonCache } from './metadata-json.js';
import {
  runSync, syncRoot, syncPaths, checkSyncStatus,
  collectFolder, isBinaryExtension,
  checkPushStatus, runPush, computePushDiffs,
  checkLocalSyncBadges, checkPullStatus, runPull, runRevert,
} from './da-sync.js';
import { runHelix6BulkWorkflow } from './helix6-bulk.js';
import log from './logger.js';

// Use the basic (plaintext) Chromium password store instead of the macOS
// keychain. Without this, Chromium's "Safe Storage" cookie encryption prompts
// for keychain access on launch. This app stores nothing sensitive; revisit
// (and remove this) if/when real secret storage via safeStorage is added.
app.commandLine.appendSwitch('password-store', 'basic');

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, '..', 'renderer');
const preloadPath = join(here, '..', 'preload', 'index.cjs');

const SITES_FILENAME = 'sites.json';
const SYNC_FOLDER_FILENAME = 'sync-folder.json';

let mainWindow;
let sitesCache = [];
/** @type {ReturnType<typeof createPreviewServerRegistry>|null} */
let previewRegistry = null;
/** @type {{ clearCache: () => void }|null} */
let contentDaLiveAuth = null;

function userDataPath(name) {
  return join(app.getPath('userData'), name);
}

function tokenPath() {
  return userDataPath(DA_TOKEN_FILENAME);
}

function siteTokensPath() {
  return userDataPath(SITE_TOKEN_FILENAME);
}

function sitesPath() {
  return userDataPath(SITES_FILENAME);
}

function syncFolderStorePath() {
  return userDataPath(SYNC_FOLDER_FILENAME);
}

async function ensureSitesLoaded() {
  if (sitesCache.length === 0) {
    sitesCache = await loadSites(sitesPath());
  }
  return sitesCache;
}

async function persistSites(sites) {
  sitesCache = sites;
  await saveSites(sitesPath(), sites);
}

/**
 * @param {unknown} err
 * @returns {{ message: string, xError: string|null, status: number|null }|null}
 */
function toRequestErrorPayload(err) {
  if (err instanceof HttpRequestError) {
    return {
      message: err.message,
      xError: err.xError ?? null,
      status: err.status ?? null,
    };
  }
  return null;
}

async function resolvePreviewSite(siteId) {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    return null;
  }
  return {
    org: site.org,
    repo: site.repo,
    branch: site.branch,
    previewUrl: site.previewUrl,
    apiBackend: site.apiBackend,
  };
}

async function setActivePreviewSite(siteId) {
  if (!previewRegistry) {
    throw new Error('Preview proxy is not ready');
  }

  if (!siteId) {
    await previewRegistry.activateSite(null, null);
    return;
  }

  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  await previewRegistry.activateSite(siteId, {
    org: site.org,
    repo: site.repo,
    branch: site.branch,
    previewUrl: site.previewUrl,
    apiBackend: site.apiBackend,
  });
}

/** @type {Record<string, { token: string, expiresAt: number|null }>|null} */
let siteTokensCache = null;

async function ensureSiteTokensLoaded() {
  if (!siteTokensCache) {
    siteTokensCache = await loadSiteTokens(siteTokensPath());
  }
  return siteTokensCache;
}

/**
 * Returns a valid EDS site token for the given preview site, or null.
 *
 * @param {{ previewUrl: string }} site
 * @returns {Promise<string|null>}
 */
async function getSiteTokenFor(site) {
  const tokens = await ensureSiteTokensLoaded();
  const entry = tokens[siteTokenKey(site.previewUrl)];
  return isSiteTokenExpired(entry) ? null : entry.token;
}

/**
 * Opens the in-app preview sign-in for a site, captures the minted site token,
 * and persists it.
 *
 * @param {{
 *   org: string,
 *   repo: string,
 *   previewUrl: string,
 *   apiBackend?: string,
 * }} site
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function loginPreviewSite(site) {
  try {
    const entry = await openPreviewLogin({
      org: site.org,
      site: site.repo,
      ref: parsePreviewRef(site.previewUrl),
      adminBase: adminBaseForApiBackend(site.apiBackend),
      parent: mainWindow,
      log,
    });
    const tokens = await ensureSiteTokensLoaded();
    tokens[siteTokenKey(site.previewUrl)] = entry;
    await saveSiteTokens(siteTokensPath(), tokens);
    previewRegistry?.clearHeadCache(siteTokenKey(site.previewUrl));
    return { ok: true };
  } catch (err) {
    log.scope('preview-login').warn(err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Removes every trace of the DA sign-in: token file, per-site preview tokens,
 * in-memory caches, and IMS/DA cookies + storage in all Electron sessions.
 */
async function invalidateCurrentDaSession() {
  await invalidateDaSession({
    tokenPath: tokenPath(),
    siteTokensPath: siteTokensPath(),
    electronSession: session,
    partitions: [PREVIEW_WEBVIEW_PARTITION, PREVIEW_LOGIN_PARTITION],
    clearContentAuthCache: () => contentDaLiveAuth?.clearCache(),
    clearPreviewCaches: () => previewRegistry?.clearHeadCache(),
    resetSiteTokensCache: () => {
      siteTokensCache = null;
    },
  });
}

/**
 * Enriches an unauthorized error with token diagnostics, wipes the now-known-
 * bad session, and tells the renderer to fall back to the sign-in screen.
 *
 * @param {Error} err
 * @param {{ org: string, repo: string }} site
 * @param {string} backend
 * @returns {Promise<Error>} the error to rethrow
 */
async function handleDaUnauthorized(err, site, backend) {
  const stored = await loadStoredToken(tokenPath());
  const diagnostics = describeTokenDiagnostics(stored);
  log.scope('da-auth').warn(
    `unauthorized for ${site.org}/${site.repo} via ${backend}: ${err.message} [${diagnostics}]`,
  );

  try {
    await invalidateCurrentDaSession();
  } catch (cleanupErr) {
    log.scope('da-auth').warn(`session cleanup failed: ${cleanupErr.message}`);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('da:session-expired', { message: err.message });
  }

  const detail = `${err.message}\n`
    + `Site: ${site.org}/${site.repo} via ${backend}\n`
    + `Token: ${diagnostics}\n`
    + 'The stored sign-in was removed — use "Sign in to AEM" to start a fresh session.';
  if (err instanceof HttpRequestError) {
    return new HttpRequestError(detail, err);
  }
  return new Error(detail);
}

async function withContentClient(site, fn) {
  const backend = site.apiBackend || API_BACKEND_DA_LIVE;
  try {
    // Never trigger a silent browser login from a background request: a
    // missing/expired token throws an unauthorized error with the reason,
    // and the renderer routes the user to the explicit Sign in button.
    const accessToken = await resolveStoredAccessToken(tokenPath());
    return await fn(new ContentApiClient(accessToken, backend));
  } catch (err) {
    if (isDaUnauthorizedError(err)) {
      throw await handleDaUnauthorized(err, site, backend);
    }
    throw err;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the user's browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  let devTools;
  if (!app.isPackaged) {
    devTools = await import('./dev-reload.js');
    // Attach before load so the renderer's startup logs are captured too.
    devTools.forwardRendererConsole(mainWindow);
  }

  await mainWindow.loadFile(join(rendererDir, 'index.html'));

  if (devTools) {
    devTools.watchRenderer(mainWindow, rendererDir);
  }
}

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:is-dev', () => !app.isPackaged);

ipcMain.handle('dev:open-app-devtools', (event) => {
  if (app.isPackaged) {
    return false;
  }
  event.sender.openDevTools({ mode: 'detach' });
  return true;
});

ipcMain.handle('app:open-external', (_event, { url }) => {
  shell.openExternal(url);
});

ipcMain.handle('app:show-error-dialog', async (_event, {
  title, message, detail, xError,
}) => {
  const dialogTitle = title || 'Error';
  const lines = [];
  const body = detail || message || '';
  if (body) {
    lines.push(body);
  }
  if (xError && !body.includes(`x-error: ${xError}`)) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`x-error: ${xError}`);
  }
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: dialogTitle,
    message: dialogTitle,
    detail: lines.join('\n') || 'An unexpected error occurred.',
  });
});

ipcMain.handle('preview:build-url', async (_event, { siteId, daPath }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }
  await setActivePreviewSite(siteId);
  const previewServerBase = previewRegistry?.getBaseUrl();
  if (!previewServerBase) {
    throw new Error('Preview proxy is not ready');
  }
  return buildProxyPreviewUrl(previewServerBase, daPath);
});

ipcMain.handle('preview:set-active-site', async (_event, { siteId }) => {
  if (siteId) {
    await setActivePreviewSite(siteId);
    return;
  }
  await setActivePreviewSite(null);
});

ipcMain.handle('preview:build-aem-urls', async (_event, { siteId, daPaths }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }
  return daPaths.map((daPath) => buildPreviewUrl(site.previewUrl, daPath));
});

ipcMain.handle('sites:list', async () => {
  await ensureSitesLoaded();
  return sitesCache;
});

ipcMain.handle('sites:add', async (_event, { url, apiBackend }) => {
  const sites = await ensureSitesLoaded();
  const { site, sites: next } = addSiteFromUrl(sites, url, apiBackend);
  await persistSites(next);
  return site;
});

ipcMain.handle('sites:remove', async (_event, { id }) => {
  const sites = await ensureSitesLoaded();
  const next = removeSite(sites, id);
  await persistSites(next);
  return next;
});

ipcMain.handle('da:auth-status', async () => getAuthStatus(tokenPath()));

ipcMain.handle('da:login', async () => {
  await getValidToken({
    tokenPath: tokenPath(),
    openBrowser: (url) => shell.openExternal(url),
  });
  contentDaLiveAuth?.clearCache();
  return getAuthStatus(tokenPath());
});

ipcMain.handle('da:logout', async () => {
  await invalidateCurrentDaSession();
  return getAuthStatus(tokenPath());
});

ipcMain.handle('preview:login', async (_event, { siteId }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }
  return loginPreviewSite({
    org: site.org,
    repo: site.repo,
    previewUrl: site.previewUrl,
    apiBackend: site.apiBackend,
  });
});

ipcMain.handle('da:list', async (_event, { siteId, daPath = '/' }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return withContentClient(site, async (client) => {
    const items = await client.list(site.org, site.repo, daPath);
    return items.map((item) => ({
      ...item,
      daPath: toDaPath(item.path, site.org, site.repo),
      isFolder: item.ext === undefined,
    }));
  });
});

ipcMain.handle('da:get-source', async (_event, { siteId, daPath }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return withContentClient(site, async (client) => {
    const result = await client.getSource(site.org, site.repo, daPath);
    if (!result) {
      return null;
    }

    const name = daPath.split('/').pop() || daPath;
    const formatted = formatContentForDisplay({
      name,
      contentType: result.contentType,
      body: result.body,
      isText: result.isText,
    });

    return {
      daPath,
      contentType: result.contentType,
      ...formatted,
    };
  });
});

ipcMain.handle('document:parse', async (_event, { html }) => parseDocumentHtml(html));

/**
 * @param {string} path
 * @returns {Promise<string|null>}
 */
async function readTextFileIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

const DOCUMENT_DIFF_EXTS = new Set(['html', 'htm']);

// Track-changes diff between the synced original (remote snapshot under
// `.aem/`) and the local working copy. Returns null when there is nothing
// local to compare, so the renderer can fall back to the plain remote view.
ipcMain.handle('document:diff', async (_event, { siteId, destFolder, daPath }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }
  if (!destFolder) {
    return null;
  }
  const ext = daPath.split('.').pop().toLowerCase();
  if (!DOCUMENT_DIFF_EXTS.has(ext)) {
    return null;
  }

  const { workingPath, originalPath } = syncPaths(destFolder, site.org, site.repo, daPath);
  const [working, original] = await Promise.all([
    readTextFileIfExists(workingPath),
    readTextFileIfExists(originalPath),
  ]);
  if (working === null && original === null) {
    return null;
  }

  const diff = diffDocumentHtml(original ?? '', working ?? '');
  let status = 'modified';
  if (!diff.changed) {
    status = 'unchanged';
  } else if (original === null) {
    status = 'new';
  } else if (working === null) {
    status = 'deleted';
  }
  return { status, diff };
});

let syncAbortController = null;

ipcMain.handle('sync:get-folder', async () => loadSyncFolder(syncFolderStorePath()));

ipcMain.handle('sync:set-folder', async (_event, { destFolder }) => {
  await saveSyncFolder(syncFolderStorePath(), destFolder || null);
  return destFolder || null;
});

ipcMain.handle('sync:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose sync destination',
    buttonLabel: 'Select Folder',
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  const folder = result.filePaths[0];
  await saveSyncFolder(syncFolderStorePath(), folder);
  return folder;
});

ipcMain.handle('sync:check', async (event, {
  siteId, items, destFolder, includeBinaries,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return withContentClient(site, async (client) => {
    const allFiles = [];
    const reportProgress = (discovered) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('sync:check-progress', { discovered });
      }
    };

    for (const item of items) {
      if (item.isFolder) {
        const base = allFiles.length;
        // eslint-disable-next-line no-await-in-loop
        const children = await collectFolder(
          client,
          site.org,
          site.repo,
          item.daPath,
          includeBinaries,
          undefined,
          ({ discovered }) => reportProgress(base + discovered),
        );
        allFiles.push(...children);
      } else {
        if (!includeBinaries && isBinaryExtension(item.ext)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        allFiles.push({
          daPath: item.daPath,
          ext: item.ext,
          lastModified: item.lastModified,
        });
        reportProgress(allFiles.length);
      }
    }

    const filtered = includeBinaries
      ? allFiles
      : allFiles.filter((f) => !isBinaryExtension(f.ext));

    const status = await checkSyncStatus({
      destRoot: destFolder,
      org: site.org,
      repo: site.repo,
      remoteFiles: filtered,
      scopePaths: items.map((i) => i.daPath),
    });

    return { ...status, totalFiles: filtered.length };
  });
});

ipcMain.handle('sync:run', async (event, {
  siteId, items, destFolder, includeBinaries, skipConflicts,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  syncAbortController = new AbortController();
  const { signal } = syncAbortController;

  try {
    const skip = skipConflicts?.length
      ? new Set(skipConflicts)
      : undefined;
    const manifest = await withContentClient(site, (client) => runSync({
      client,
      org: site.org,
      repo: site.repo,
      items,
      destRoot: destFolder,
      includeBinaries,
      skipPaths: skip,
      signal,
      onProgress: (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('sync:progress', data);
        }
      },
    }));
    return {
      ok: true,
      fileCount: manifest.files.length,
      syncedPath: syncRoot(destFolder, site.org, site.repo),
    };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, cancelled: true };
    }
    const error = toRequestErrorPayload(err);
    if (error) {
      return { ok: false, error };
    }
    throw err;
  } finally {
    syncAbortController = null;
  }
});

ipcMain.handle('sync:cancel', () => {
  if (syncAbortController) {
    syncAbortController.abort();
    syncAbortController = null;
  }
});

ipcMain.handle('sync:reveal', (_event, { folderPath }) => {
  shell.showItemInFolder(folderPath);
});

ipcMain.handle('sync:local-badges', async (_event, {
  siteId, destFolder, folderPath, items,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return checkLocalSyncBadges({
    destRoot: destFolder,
    org: site.org,
    repo: site.repo,
    folderPath,
    items,
  });
});

let pullAbortController = null;

ipcMain.handle('pull:check', async (event, {
  siteId, destFolder, includeBinaries,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return withContentClient(site, (client) => checkPullStatus({
    client,
    org: site.org,
    repo: site.repo,
    destRoot: destFolder,
    includeBinaries,
    onProgress: (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('pull:check-progress', data);
      }
    },
  }));
});

ipcMain.handle('pull:run', async (event, {
  siteId, destFolder, files,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  pullAbortController = new AbortController();
  const { signal } = pullAbortController;

  try {
    const result = await withContentClient(site, (client) => runPull({
      client,
      org: site.org,
      repo: site.repo,
      destRoot: destFolder,
      files,
      signal,
      onProgress: (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('pull:progress', data);
        }
      },
    }));
    return { ok: true, ...result };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, cancelled: true };
    }
    throw err;
  } finally {
    pullAbortController = null;
  }
});

ipcMain.handle('pull:cancel', () => {
  if (pullAbortController) {
    pullAbortController.abort();
    pullAbortController = null;
  }
});

let pushAbortController = null;
let helix6AbortController = null;

ipcMain.handle('push:check', async (_event, {
  siteId, destFolder,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return checkPushStatus({
    destRoot: destFolder,
    org: site.org,
    repo: site.repo,
  });
});

let revertAbortController = null;

ipcMain.handle('revert:run', async (event, {
  siteId, destFolder, files,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  revertAbortController = new AbortController();
  const { signal } = revertAbortController;

  try {
    const result = await runRevert({
      org: site.org,
      repo: site.repo,
      destRoot: destFolder,
      files,
      signal,
      onProgress: (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('revert:progress', data);
        }
      },
    });
    return { ok: true, ...result };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, cancelled: true };
    }
    throw err;
  } finally {
    revertAbortController = null;
  }
});

ipcMain.handle('revert:cancel', () => {
  if (revertAbortController) {
    revertAbortController.abort();
    revertAbortController = null;
  }
});

ipcMain.handle('push:run', async (event, {
  siteId, destFolder, filesToPush, filesToDelete,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  pushAbortController = new AbortController();
  const { signal } = pushAbortController;

  try {
    const result = await withContentClient(site, (client) => runPush({
      client,
      org: site.org,
      repo: site.repo,
      destRoot: destFolder,
      filesToPush,
      filesToDelete,
      signal,
      onProgress: (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('push:progress', data);
        }
      },
    }));
    return { ok: true, ...result };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, cancelled: true };
    }
    const error = toRequestErrorPayload(err);
    if (error) {
      return { ok: false, error };
    }
    throw err;
  } finally {
    pushAbortController = null;
  }
});

ipcMain.handle('push:cancel', () => {
  if (pushAbortController) {
    pushAbortController.abort();
    pushAbortController = null;
  }
});

ipcMain.handle('push:diffs', async (_event, {
  siteId, destFolder, modified, localNew, deleted,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return computePushDiffs({
    destRoot: destFolder,
    org: site.org,
    repo: site.repo,
    modified,
    localNew,
    deleted,
  });
});

ipcMain.handle('helix6:run-bulk', async (event, {
  siteId, daPaths, mode,
}) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }
  if (site.apiBackend !== API_BACKEND_AEM_API) {
    throw new Error('Preview/publish jobs require api.aem.live (helix6)');
  }
  if (mode !== 'preview' && mode !== 'preview-publish') {
    throw new Error('Invalid helix6 bulk mode');
  }

  helix6AbortController = new AbortController();
  const { signal } = helix6AbortController;

  try {
    await withContentClient(site, async (client) => {
      await runHelix6BulkWorkflow({
        client,
        org: site.org,
        repo: site.repo,
        daPaths,
        mode,
        signal,
        onProgress: (data) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('helix6:bulk-progress', data);
          }
        },
      });
    });
    return { ok: true };
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, cancelled: true };
    }
    const error = toRequestErrorPayload(err);
    if (error) {
      return { ok: false, error };
    }
    throw err;
  } finally {
    helix6AbortController = null;
  }
});

ipcMain.handle('helix6:cancel', () => {
  if (helix6AbortController) {
    helix6AbortController.abort();
    helix6AbortController = null;
  }
});

// Development convenience: double-clicking anywhere in the UI captures a
// screenshot to a temp file and logs the path to stderr for agents to pick up.
ipcMain.handle('dev:capture-screenshot', async (event) => {
  if (app.isPackaged) {
    return null;
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return null;
  }
  const image = await win.webContents.capturePage();
  const file = join(tmpdir(), screenshotFilename());
  await writeFile(file, image.toPNG());
  // `warn` routes to stderr in electron-log; agents read the path from stderr.
  log.scope('screenshot').warn(file);
  return file;
});

app.whenReady().then(async () => {
  contentDaLiveAuth = initContentDaLiveAuth(tokenPath(), session);

  previewRegistry = createPreviewServerRegistry({
    startPreviewServer,
    createHeadHtmlCache,
    createMetadataJsonCache,
    getSyncFolder: () => loadSyncFolder(syncFolderStorePath()),
    resolveActiveSite: resolvePreviewSite,
    getToken: getSiteTokenFor,
    onAuthRequired: (site) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('preview:auth-required', {
          previewUrl: site.previewUrl,
        });
      }
    },
    log,
  });

  await createWindow();
  initAutoUpdater({ isPackaged: app.isPackaged });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('will-quit', () => {
    previewRegistry?.closeAll().catch(() => {});
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
