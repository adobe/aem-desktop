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
import { BrowserWindow } from 'electron';
import {
  buildAuthUrl, saveToken, waitForToken,
} from './da-auth.js';
import { isAllowedDaLoginNavigation } from './da-login-url.js';
import { DA_AUTH_STORAGE_TYPES } from './da-session.js';

// Dedicated partition for IMS sign-in. Cleared before each interactive login so
// a cached Adobe session in the system browser cannot skip org selection.
export const DA_LOGIN_PARTITION = 'persist:aem-da-login';

const IMS_LOGIN_ORIGINS = ['https://ims-na1.adobelogin.com'];

/**
 * @param {typeof import('electron').session} electronSession
 */
export async function clearDaLoginSession(electronSession) {
  await electronSession.fromPartition(DA_LOGIN_PARTITION).clearStorageData({
    storages: DA_AUTH_STORAGE_TYPES,
    origins: IMS_LOGIN_ORIGINS,
  });
}

/**
 * Runs the IMS implicit OAuth flow in an in-app window so the user can pick an
 * Adobe org instead of reusing a cached session from the system browser.
 *
 * @param {{
 *   tokenPath: string,
 *   parent?: import('electron').BrowserWindow,
 *   electronSession?: typeof import('electron').session,
 *   log?: import('electron-log').MainLogger,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<string>} access token
 */
export function performDaLogin({
  tokenPath,
  parent,
  electronSession,
  log,
  timeoutMs = 5 * 60 * 1000,
}) {
  const scope = log?.scope ? log.scope('da-login') : log;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    /** @type {import('electron').BrowserWindow|null} */
    let win = null;

    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (win && !win.isDestroyed()) {
        win.close();
      }
      fn(value);
    };

    const start = async () => {
      if (electronSession) {
        await clearDaLoginSession(electronSession);
      }

      const authUrl = buildAuthUrl({ prompt: 'login' });
      const tokenPromise = waitForToken();

      win = new BrowserWindow({
        parent,
        width: 570,
        height: 720,
        show: true,
        title: 'Sign in to AEM',
        autoHideMenuBar: true,
        webPreferences: {
          partition: DA_LOGIN_PARTITION,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });

      const guardNavigation = (label) => (event, url) => {
        if (isAllowedDaLoginNavigation(url)) {
          scope?.info?.(`${label} ${new URL(url).origin}`);
        } else {
          event.preventDefault();
          scope?.warn?.(`blocked ${label} ${url}`);
        }
      };
      win.webContents.on('will-navigate', guardNavigation('navigate'));
      win.webContents.on('will-redirect', guardNavigation('redirect'));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      win.on('closed', () => {
        finish(reject, new Error('Sign-in cancelled before an Adobe org was selected.'));
      });

      timer = setTimeout(() => {
        finish(reject, new Error('Login timed out (5 minutes). Please try again.'));
      }, timeoutMs);

      tokenPromise
        .then(async ({ token, expiresIn }) => {
          await saveToken(tokenPath, {
            access_token: token,
            expires_at: expiresIn ? Date.now() + (expiresIn * 1000) : null,
          });
          scope?.info?.('captured IMS token');
          finish(resolve, token);
        })
        .catch((err) => finish(reject, err));

      scope?.info?.(`opening ${authUrl}`);
      win.loadURL(authUrl).catch((err) => finish(reject, err));
    };

    start().catch((err) => finish(reject, err));
  });
}
