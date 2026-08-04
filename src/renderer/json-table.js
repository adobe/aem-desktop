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
 * @typedef {{ name: string, columns: string[], rows: string[][] }} JsonSheet
 */

/**
 * Formats a JSON value for display in a table cell.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string[]} column keys in first-seen order
 */
function unionColumns(rows) {
  const cols = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue; // eslint-disable-line no-continue
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

/**
 * Builds a single sheet from an array of records (AEM sheet `data`).
 *
 * @param {string} name
 * @param {unknown[]} data
 * @returns {JsonSheet}
 */
function sheetFromData(name, data) {
  const records = Array.isArray(data) ? data : [];
  const objectRows = records.filter((r) => r && typeof r === 'object' && !Array.isArray(r));

  // Array of primitives (or mixed) → single "value" column.
  if (objectRows.length === 0 && records.length > 0) {
    return { name, columns: ['value'], rows: records.map((v) => [formatCell(v)]) };
  }

  const columns = unionColumns(objectRows);
  const rows = records.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return [formatCell(record), ...columns.slice(1).map(() => '')];
    }
    return columns.map((col) => formatCell(record[col]));
  });
  return { name, columns, rows };
}

/**
 * Key/value table for a plain (non-sheet) JSON object, skipping AEM meta keys
 * (those prefixed with `:`).
 *
 * @param {Record<string, unknown>} obj
 * @returns {JsonSheet}
 */
function sheetFromObject(obj) {
  const rows = Object.entries(obj)
    .filter(([key]) => !key.startsWith(':'))
    .map(([key, value]) => [key, formatCell(value)]);
  return { name: '', columns: ['key', 'value'], rows };
}

/**
 * Normalizes parsed JSON into one or more displayable sheets. Handles AEM
 * single-sheet (`{ data: [...] }`), multi-sheet (`{ ':names': [...] }`), bare
 * arrays, and plain objects (rendered as a key/value table).
 *
 * @param {unknown} data
 * @returns {JsonSheet[]}
 */
export function jsonToSheets(data) {
  if (Array.isArray(data)) {
    return [sheetFromData('', data)];
  }
  if (!data || typeof data !== 'object') {
    return [{ name: '', columns: ['value'], rows: [[formatCell(data)]] }];
  }

  const record = /** @type {Record<string, unknown>} */ (data);

  // AEM multi-sheet: one named sheet per entry in `:names`.
  const names = record[':names'];
  if (Array.isArray(names) && names.length > 0) {
    return names.map((name) => {
      const sheet = record[name];
      const sheetData = sheet && typeof sheet === 'object' ? sheet.data : undefined;
      return sheetFromData(String(name), Array.isArray(sheetData) ? sheetData : []);
    });
  }

  // AEM single sheet.
  if (Array.isArray(record.data)) {
    return [sheetFromData('', record.data)];
  }

  // Fallback: key/value view of the object.
  return [sheetFromObject(record)];
}
