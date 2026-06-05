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

// Pure development helpers — no `electron` import — so they can be unit tested
// under `node --test` and shared between the dev launcher and the main process.

// 9223 by convention for Electron CDP — Chrome's default remote-debugging port
// is 9222, so this avoids colliding with a running Chrome.
const DEFAULT_CDP_PORT = 9223;

/**
 * Resolve the Chrome DevTools Protocol (remote debugging) port for the dev
 * build, honoring `AEM_DESKTOP_CDP_PORT` and falling back to 9223.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function resolveCdpPort(env = process.env) {
  const port = Number.parseInt(env.AEM_DESKTOP_CDP_PORT ?? '', 10);
  if (Number.isInteger(port) && port > 0 && port < 65536) {
    return port;
  }
  return DEFAULT_CDP_PORT;
}

/**
 * Build a filesystem-safe, timestamped screenshot filename.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function screenshotFilename(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `aem-desktop-${stamp}.png`;
}
