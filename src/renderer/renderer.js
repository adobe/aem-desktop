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
async function renderVersion() {
  const target = document.getElementById('version');
  try {
    target.textContent = await window.aemDesktop.getVersion();
  } catch {
    target.textContent = 'unknown';
  }
}

function renderLoadedAt() {
  document.getElementById('loaded').textContent = new Date().toLocaleTimeString();
}

// Development: double-click anywhere to capture a screenshot. The main process
// writes it to a temp file and logs the path to stderr (no-op in packaged builds).
window.addEventListener('dblclick', () => {
  window.aemDesktop.captureScreenshot();
});

renderVersion();
renderLoadedAt();
console.log(`AEM Desktop renderer ready at ${new Date().toLocaleTimeString()}`);
