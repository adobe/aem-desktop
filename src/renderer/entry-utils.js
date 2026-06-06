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

/** Resource kind from extension (icons, list behavior). Mirrors da-nx browse/utils.js. */
export const RESOURCE_TYPE = Object.freeze({
  folder: 'folder',
  document: 'document',
  media: 'media',
  sheet: 'sheet',
  file: 'file',
});

/** Whether the list API row is a folder (no non-empty `ext`). */
export function isFolder(row) {
  return row?.ext == null || String(row.ext).trim() === '';
}

export function entryTypeFromExtension(ext) {
  if (ext == null || ext === '') {
    return RESOURCE_TYPE.folder;
  }
  const e = String(ext).replace(/^\./, '').toLowerCase();
  if (['html', 'htm'].includes(e)) {
    return RESOURCE_TYPE.document;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov'].includes(e)) {
    return RESOURCE_TYPE.media;
  }
  if (['json', 'xlsx', 'xls', 'csv'].includes(e)) {
    return RESOURCE_TYPE.sheet;
  }
  return RESOURCE_TYPE.file;
}

export function getIconByExtension(ext) {
  switch (entryTypeFromExtension(ext)) {
    case RESOURCE_TYPE.folder:
      return 'folder';
    case RESOURCE_TYPE.document:
      return 'fileText';
    case RESOURCE_TYPE.media:
      return 'image';
    case RESOURCE_TYPE.sheet:
      return 'table';
    case RESOURCE_TYPE.file:
    default:
      return 'fileText';
  }
}

/**
 * Display label for a tree row. HTML omits the extension; others include it.
 *
 * @param {{ name: string, ext?: string, isFolder?: boolean }} item
 * @returns {string}
 */
export function entryDisplayLabel(item) {
  if (item.isFolder || isFolder(item)) {
    return item.name;
  }
  const ext = String(item.ext).replace(/^\./, '').toLowerCase();
  if (['html', 'htm'].includes(ext)) {
    return item.name;
  }
  return `${item.name}.${item.ext}`;
}

/**
 * Strips `.html` / `.htm` suffix from a DA path for display.
 *
 * @param {string} daPath
 * @returns {string}
 */
export function displayPath(daPath) {
  return daPath.replace(/\.html?$/i, '');
}
