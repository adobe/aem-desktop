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

/** Product token identifying the desktop app in outbound requests. */
export const USER_AGENT_PRODUCT = 'AEM-Desktop';

/**
 * Appends an `AEM-Desktop/<version>` product token to the base (Chromium/
 * Electron) user-agent so all network traffic identifies the app and version
 * while staying browser-compatible for EDS/preview. Idempotent: re-appending
 * the same token is a no-op.
 *
 * @param {string} baseUserAgent - the default Electron/Chromium UA
 * @param {string} version - the app version (e.g. app.getVersion())
 * @returns {string}
 */
export function appDesktopUserAgent(baseUserAgent, version) {
  const token = `${USER_AGENT_PRODUCT}/${version || '0.0.0'}`;
  const base = String(baseUserAgent || '').trim();
  if (!base) {
    return token;
  }
  if (base.split(/\s+/).includes(token)) {
    return base;
  }
  return `${base} ${token}`;
}
