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
import { watch } from 'node:fs';

/**
 * Live-reload the renderer when files under `rendererDir` change.
 *
 * The renderer is plain ESM served over file://, so a full reload is the
 * bundler-free equivalent of HMR. Main/preload changes are handled out of
 * process by scripts/dev.js, which restarts Electron entirely.
 *
 * @param {import('electron').BrowserWindow} window
 * @param {string} rendererDir absolute path to the renderer source directory
 * @returns {import('node:fs').FSWatcher}
 */
export function watchRenderer(window, rendererDir) {
  let pending;
  const watcher = watch(rendererDir, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.reloadIgnoringCache();
      }
    }, 100);
  });
  window.on('closed', () => watcher.close());
  return watcher;
}
