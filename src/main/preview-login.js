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
import { BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAdminLoginUrl, isAllowedLoginNavigation, siteTokenEntryFromMessage,
} from './preview-login-url.js';

const here = dirname(fileURLToPath(import.meta.url));
const loginPreload = join(here, '..', 'preload', 'preview-login-preload.cjs');

// Persistent partition so the IMS session cookie survives between logins —
// after the first interactive sign-in, token refreshes can complete silently.
export const PREVIEW_LOGIN_PARTITION = 'persist:aem-preview-login';
const TOKEN_MESSAGE_CHANNEL = 'preview-login:message';

/**
 * Opens the admin login in a dedicated window and resolves with the captured
 * site-token entry. The window's preload shims chrome.runtime.sendMessage so we
 * receive the same payload the admin page would hand the AEM Sidekick.
 *
 * @param {{
 *   org: string,
 *   site: string,
 *   ref: string,
 *   parent?: import('electron').BrowserWindow,
 *   adminBase?: string,
 *   extensionId?: string,
 *   timeoutMs?: number,
 *   log?: import('electron-log').MainLogger,
 * }} opts
 * @returns {Promise<{ token: string, expiresAt: number|null }>}
 */
export function openPreviewLogin({
  org, site, ref, parent, adminBase, extensionId = 'aem-desktop-preview-login',
  timeoutMs = 5 * 60 * 1000, log,
}) {
  const scope = log?.scope ? log.scope('preview-login') : log;
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent,
      width: 570,
      height: 720,
      show: true,
      title: 'Sign in to preview',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PREVIEW_LOGIN_PARTITION,
        preload: loginPreload,
        // The shim must run in the page's main world to intercept the admin
        // page's chrome.runtime call, so isolation is off for this window only.
        contextIsolation: false,
        sandbox: false,
        nodeIntegration: false,
      },
    });

    let settled = false;
    let timer = null;
    /** @type {(event: import('electron').IpcMainEvent, message: any) => void} */
    let onMessage;

    const settle = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeListener(TOKEN_MESSAGE_CHANNEL, onMessage);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn(value);
      if (!win.isDestroyed()) {
        win.close();
      }
    };

    onMessage = (event, message) => {
      if (win.isDestroyed() || event.sender !== win.webContents) {
        return;
      }
      const entry = siteTokenEntryFromMessage(message);
      if (entry) {
        scope?.info?.('captured site token');
        settle(resolve, entry);
      }
    };

    // Keep the contextIsolation-disabled window pinned to the admin/IdP origins.
    // Block any other navigation and never open child windows in-app.
    const guardNavigation = (label) => (event, url) => {
      if (isAllowedLoginNavigation(url)) {
        scope?.info?.(`${label} ${new URL(url).origin}`);
      } else {
        event.preventDefault();
        scope?.warn?.(`blocked ${label} ${url}`);
      }
    };
    win.webContents.on('will-navigate', guardNavigation('navigate'));
    win.webContents.on('will-redirect', guardNavigation('redirect'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    ipcMain.on(TOKEN_MESSAGE_CHANNEL, onMessage);

    win.on('closed', () => {
      settle(reject, new Error('Login window closed before a site token was captured'));
    });

    timer = setTimeout(() => {
      settle(reject, new Error('Preview login timed out'));
    }, timeoutMs);

    const loginUrl = buildAdminLoginUrl({
      org, site, ref, adminBase, extensionId,
    });
    scope?.info?.(`opening ${loginUrl}`);
    win.loadURL(loginUrl).catch((err) => settle(reject, err));
  });
}
