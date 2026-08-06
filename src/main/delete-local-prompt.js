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
 * Builds the confirmation copy shown before deleting a connection's locally
 * synced content. When unpushed local changes exist, the detail carries an
 * extra warning that they will be lost.
 *
 * @param {{ org: string, repo: string, changeCount?: number }} options
 * @returns {{ message: string, detail: string }}
 */
export function buildDeleteLocalPrompt({ org, repo, changeCount = 0 }) {
  const label = `${org}/${repo}`;
  const lines = [
    `This permanently removes all locally synced content for ${label} from your sync folder.`,
  ];
  if (changeCount > 0) {
    const noun = changeCount === 1 ? 'change has' : 'changes have';
    lines.push('');
    lines.push(
      `Warning: ${changeCount} local ${noun} not been pushed and will be lost.`,
    );
  }
  return {
    message: `Delete locally synced content for ${label}?`,
    detail: lines.join('\n'),
  };
}
