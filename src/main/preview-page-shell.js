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
 * Wraps body-only preview HTML in the standard EDS page shell so client-side
 * decoration (e.g. scripts.js `decorateMain(document.querySelector('main'))`)
 * runs the same as `aem up` / `.aem.page`.
 *
 * @param {string} bodyHtml
 * @returns {string}
 */
export function wrapPreviewPageBody(bodyHtml) {
  const trimmed = bodyHtml.trim();
  if (!trimmed) {
    return '<header></header><main></main><footer></footer>';
  }
  if (/<main[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<header></header><main>${trimmed}</main><footer></footer>`;
}
