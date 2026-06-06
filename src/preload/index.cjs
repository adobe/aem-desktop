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

// Sandboxed preload scripts must be CommonJS; ESM imports are unavailable
// when `sandbox: true`. This is the only non-ESM module in the app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aemDesktop', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
  captureScreenshot: () => ipcRenderer.invoke('dev:capture-screenshot'),

  listSites: () => ipcRenderer.invoke('sites:list'),
  addSite: (url) => ipcRenderer.invoke('sites:add', { url }),
  removeSite: (id) => ipcRenderer.invoke('sites:remove', { id }),

  getDaAuthStatus: () => ipcRenderer.invoke('da:auth-status'),
  loginDa: () => ipcRenderer.invoke('da:login'),
  listDa: (siteId, daPath) => ipcRenderer.invoke('da:list', { siteId, daPath }),
  getDaSource: (siteId, daPath) => ipcRenderer.invoke('da:get-source', { siteId, daPath }),
  buildPreviewUrl: (siteId, daPath) => ipcRenderer.invoke('preview:build-url', { siteId, daPath }),

  pickSyncFolder: () => ipcRenderer.invoke('sync:pick-folder'),
  checkSync: (options) => ipcRenderer.invoke('sync:check', options),
  runSync: (options) => ipcRenderer.invoke('sync:run', options),
  cancelSync: () => ipcRenderer.invoke('sync:cancel'),
  revealSync: (folderPath) => ipcRenderer.invoke('sync:reveal', { folderPath }),
  onSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  },

  checkPush: (options) => ipcRenderer.invoke('push:check', options),
  runPush: (options) => ipcRenderer.invoke('push:run', options),
  cancelPush: () => ipcRenderer.invoke('push:cancel'),
  onPushProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('push:progress', handler);
    return () => ipcRenderer.removeListener('push:progress', handler);
  },
});
