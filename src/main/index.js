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
import { createWindowOptions } from './window-options.js';
import { initAutoUpdater } from './updater.js';

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

  await mainWindow.loadFile(join(rendererDir, 'index.html'));

  if (!app.isPackaged) {
    const { watchRenderer } = await import('./dev-reload.js');
    watchRenderer(mainWindow, rendererDir);
  }
}

ipcMain.handle('app:get-version', () => app.getVersion());

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
