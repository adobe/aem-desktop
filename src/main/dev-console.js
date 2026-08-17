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
import log from './logger.js';

const rendererLog = log.scope('renderer');

const NUMERIC_LEVELS = ['debug', 'info', 'warning', 'error'];
const LEVEL_METHODS = {
  warning: 'warn',
  error: 'error',
  info: 'info',
  debug: 'debug',
  log: 'info',
};

/**
 * Forward the renderer's `console.*` output through the shared logger so it
 * shows up in the `npm run dev` terminal (and log file) instead of only the
 * DevTools console.
 *
 * Handles both the legacy positional `console-message` signature and the
 * newer single-details-object form.
 *
 * @param {import('electron').BrowserWindow} window
 */
export function forwardRendererConsole(window) {
  window.webContents.on('console-message', (...args) => {
    const first = args[0];
    let level;
    let message;
    if (first && typeof first === 'object' && 'message' in first) {
      ({ level, message } = first);
    } else {
      [, level, message] = args;
    }
    const name = typeof level === 'number' ? NUMERIC_LEVELS[level] : level;
    const method = LEVEL_METHODS[name] ?? 'info';
    rendererLog[method](message);
  });
}
