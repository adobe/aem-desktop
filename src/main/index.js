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
  app, BrowserWindow, dialog, ipcMain, shell,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { createWindowOptions } from './window-options.js';
import { initAutoUpdater } from './updater.js';
import { screenshotFilename } from './dev-config.js';
import { toDaPath } from './aem-page-url.js';
import { DaClient } from './da-api.js';
import {
  DA_TOKEN_FILENAME, getAuthStatus, getValidToken, logout,
} from './da-auth.js';
import {
  addSiteFromUrl, findSite, loadSites, removeSite, saveSites,
} from './site-store.js';
import { loadSyncFolder, saveSyncFolder } from './sync-folder-store.js';
import { formatContentForDisplay } from './content-format.js';
import { buildPreviewUrl, buildProxyPreviewUrl } from './preview-url.js';
import { startPreviewServer } from './preview-server.js';
import { createPreviewServerRegistry } from './preview-server-registry.js';
import { createHeadHtmlCache } from './head-html.js';
import {
  runSync, syncRoot, checkSyncStatus,
  collectFolder, isBinaryExtension,
  checkPushStatus, runPush, computePushDiffs,
  checkLocalSyncBadges,
} from './da-sync.js';
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

function userDataPath(name) {
  return join(app.getPath('userData'), name);
}

function tokenPath() {
  return userDataPath(DA_TOKEN_FILENAME);
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

async function resolvePreviewSite(siteId) {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    return null;
  }
  return {
    org: site.org,
    repo: site.repo,
    previewUrl: site.previewUrl,
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
    previewUrl: site.previewUrl,
  });
}

async function withDaClient(fn) {
  const accessToken = await getValidToken({
    tokenPath: tokenPath(),
    openBrowser: (url) => shell.openExternal(url),
  });
  return fn(new DaClient(accessToken));
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

ipcMain.handle('sites:add', async (_event, { url }) => {
  const sites = await ensureSitesLoaded();
  const { site, sites: next } = addSiteFromUrl(sites, url);
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
  return getAuthStatus(tokenPath());
});

ipcMain.handle('da:logout', async () => logout(tokenPath()));

ipcMain.handle('da:list', async (_event, { siteId, daPath = '/' }) => {
  const sites = await ensureSitesLoaded();
  const site = findSite(sites, siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  return withDaClient(async (client) => {
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

  return withDaClient(async (client) => {
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

  return withDaClient(async (client) => {
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
    const manifest = await withDaClient((client) => runSync({
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

let pushAbortController = null;

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
    const result = await withDaClient((client) => runPush({
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
  previewRegistry = createPreviewServerRegistry({
    startPreviewServer,
    createHeadHtmlCache,
    getSyncFolder: () => loadSyncFolder(syncFolderStorePath()),
    resolveActiveSite: resolvePreviewSite,
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
