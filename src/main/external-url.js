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

/**
 * Guards `shell.openExternal`. Only web URLs are handed to the OS; anything else
 * (`file:`, `smb:`, `ssh:`, custom app schemes, …) is refused so a link or a
 * synced document can't invoke an arbitrary local protocol handler — a probing
 * / credential-theft / code-execution vector gated only by installed handlers.
 */

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * @param {unknown} rawUrl
 * @returns {boolean} true only for http(s) URLs
 */
export function isAllowedExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return false;
  }
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}
