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
  getRumBaseUrl: () => ipcRenderer.invoke('rum:get-base-url'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
  showErrorDialog: (options) => ipcRenderer.invoke('app:show-error-dialog', options),
  captureScreenshot: () => ipcRenderer.invoke('dev:capture-screenshot'),
  isDev: () => ipcRenderer.invoke('app:is-dev'),
  openAppDevTools: () => ipcRenderer.invoke('dev:open-app-devtools'),

  listSites: () => ipcRenderer.invoke('sites:list'),
  addSite: (url, apiBackend) => ipcRenderer.invoke('sites:add', { url, apiBackend }),
  removeSite: (id) => ipcRenderer.invoke('sites:remove', { id }),

  getDaAuthStatus: () => ipcRenderer.invoke('da:auth-status'),
  loginDa: () => ipcRenderer.invoke('da:login'),
  logoutDa: () => ipcRenderer.invoke('da:logout'),
  onDaSessionExpired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('da:session-expired', handler);
    return () => ipcRenderer.removeListener('da:session-expired', handler);
  },
  listDa: (siteId, daPath) => ipcRenderer.invoke('da:list', { siteId, daPath }),
  getDaSource: (siteId, daPath) => ipcRenderer.invoke('da:get-source', { siteId, daPath }),
  parseDocumentView: (html) => ipcRenderer.invoke('document:parse', { html }),
  getDocumentDiff: (siteId, destFolder, daPath) => ipcRenderer.invoke(
    'document:diff',
    { siteId, destFolder, daPath },
  ),
  buildPreviewUrl: (siteId, daPath) => ipcRenderer.invoke('preview:build-url', { siteId, daPath }),
  previewWebviewPartition: 'persist:aem-preview',
  buildAemPreviewUrls: (siteId, daPaths) => ipcRenderer.invoke(
    'preview:build-aem-urls',
    { siteId, daPaths },
  ),
  setActivePreviewSite: (siteId) => ipcRenderer.invoke('preview:set-active-site', { siteId }),
  loginPreview: (siteId) => ipcRenderer.invoke('preview:login', { siteId }),
  onPreviewAuthRequired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('preview:auth-required', handler);
    return () => ipcRenderer.removeListener('preview:auth-required', handler);
  },

  pickSyncFolder: () => ipcRenderer.invoke('sync:pick-folder'),
  getSyncFolder: () => ipcRenderer.invoke('sync:get-folder'),
  setSyncFolder: (destFolder) => ipcRenderer.invoke('sync:set-folder', { destFolder }),
  checkSync: (options) => ipcRenderer.invoke('sync:check', options),
  getLocalSyncBadges: (options) => ipcRenderer.invoke('sync:local-badges', options),
  runSync: (options) => ipcRenderer.invoke('sync:run', options),
  cancelSync: () => ipcRenderer.invoke('sync:cancel'),
  revealSync: (folderPath) => ipcRenderer.invoke('sync:reveal', { folderPath }),
  onSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  },
  onSyncCheckProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('sync:check-progress', handler);
    return () => ipcRenderer.removeListener('sync:check-progress', handler);
  },

  checkPull: (options) => ipcRenderer.invoke('pull:check', options),
  runPull: (options) => ipcRenderer.invoke('pull:run', options),
  cancelPull: () => ipcRenderer.invoke('pull:cancel'),
  onPullProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pull:progress', handler);
    return () => ipcRenderer.removeListener('pull:progress', handler);
  },
  onPullCheckProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pull:check-progress', handler);
    return () => ipcRenderer.removeListener('pull:check-progress', handler);
  },

  checkPush: (options) => ipcRenderer.invoke('push:check', options),
  getPushDiffs: (options) => ipcRenderer.invoke('push:diffs', options),
  runPush: (options) => ipcRenderer.invoke('push:run', options),
  cancelPush: () => ipcRenderer.invoke('push:cancel'),
  runRevert: (options) => ipcRenderer.invoke('revert:run', options),
  cancelRevert: () => ipcRenderer.invoke('revert:cancel'),
  onRevertProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('revert:progress', handler);
    return () => ipcRenderer.removeListener('revert:progress', handler);
  },
  onPushProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('push:progress', handler);
    return () => ipcRenderer.removeListener('push:progress', handler);
  },

  runHelix6Bulk: (options) => ipcRenderer.invoke('helix6:run-bulk', options),
  cancelHelix6Bulk: () => ipcRenderer.invoke('helix6:cancel'),
  onHelix6BulkProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('helix6:bulk-progress', handler);
    return () => ipcRenderer.removeListener('helix6:bulk-progress', handler);
  },
});
