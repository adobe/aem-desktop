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
import log from 'electron-log';
import electronUpdater from 'electron-updater';
import { shouldAutoUpdate } from './update-policy.js';

const { autoUpdater } = electronUpdater;

/**
 * Wire up electron-updater against the GitHub release feed configured in
 * electron-builder.yml. No-op in development or when updates are disabled.
 *
 * @param {{ isPackaged: boolean, env?: NodeJS.ProcessEnv }} ctx
 * @returns {import('electron-updater').AppUpdater | null}
 */
export function initAutoUpdater({ isPackaged, env = process.env } = {}) {
  if (!shouldAutoUpdate({ isPackaged, env })) {
    log.info('[updater] disabled (development build or AEM_DESKTOP_DISABLE_UPDATES=1)');
    return null;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => log.error('[updater] error', err));
  autoUpdater.on('checking-for-update', () => log.info('[updater] checking for update'));
  autoUpdater.on('update-available', (info) => log.info('[updater] update available', info.version));
  autoUpdater.on('update-not-available', () => log.info('[updater] up to date'));
  autoUpdater.on('download-progress', (p) => log.info(`[updater] downloading ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (info) => log.info('[updater] downloaded', info.version));

  autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('[updater] check failed', err));
  return autoUpdater;
}
