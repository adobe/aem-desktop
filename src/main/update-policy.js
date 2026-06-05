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
 * Decide whether the auto-updater should run.
 *
 * Pure (no `electron`/`electron-updater` import) so it can be unit tested.
 * Updates only run from a packaged build and can be force-disabled via the
 * `AEM_DESKTOP_DISABLE_UPDATES=1` environment variable (useful for QA).
 *
 * @param {{ isPackaged: boolean, env?: NodeJS.ProcessEnv }} ctx
 * @returns {boolean}
 */
export function shouldAutoUpdate({ isPackaged, env = process.env } = {}) {
  if (!isPackaged) {
    return false;
  }
  if (env.AEM_DESKTOP_DISABLE_UPDATES === '1') {
    return false;
  }
  return true;
}
