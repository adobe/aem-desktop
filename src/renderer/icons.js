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

const ICON_FILES = {
  folder: 'S2_Icon_Folder_20_N.svg',
  fileText: 'S2_Icon_FileText_20_N.svg',
  image: 'S2_Icon_Image_20_N.svg',
  table: 'S2_Icon_Table_20_N.svg',
  download: 'S2_Icon_Download_20_N.svg',
  upload: 'S2_Icon_Upload_20_N.svg',
};

const ICONS_BASE = new URL('./icons/', import.meta.url);

/**
 * Loads S2 icon SVGs from da-nx (browse list icon set).
 *
 * @returns {Promise<Record<string, SVGSVGElement>>}
 */
export async function loadIcons() {
  const entries = Object.entries(ICON_FILES);
  const loaded = {};

  await Promise.all(entries.map(async ([key, file]) => {
    const res = await fetch(new URL(file, ICONS_BASE));
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    loaded[key] = doc.documentElement;
  }));

  return loaded;
}

/**
 * @param {Record<string, SVGSVGElement>|null} icons
 * @param {string} key
 * @returns {SVGElement|null}
 */
export function cloneIcon(icons, key) {
  const svg = icons?.[key];
  if (!svg) {
    return null;
  }
  const clone = /** @type {SVGElement} */ (svg.cloneNode(true));
  clone.removeAttribute('id');
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.setAttribute('aria-hidden', 'true');
  clone.classList.add('entry-icon');
  return clone;
}
