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
  app, BrowserWindow, ipcMain, shell,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { createWindowOptions } from './window-options.js';
import { initAutoUpdater } from './updater.js';
import { screenshotFilename } from './dev-config.js';
import log from './logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, '..', 'renderer');
const preloadPath = join(here, '..', 'preload', 'index.cjs');

let mainWindow;

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
  await createWindow();
  initAutoUpdater({ isPackaged: app.isPackaged });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
