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
/* eslint-disable no-use-before-define */

/**
 * @param {Int32Array[]} trace
 * @param {number} offset
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {Array<{type: string, line: string, oldIdx?: number, newIdx?: number}>}
 */
function backtrack(trace, offset, oldLines, newLines) {
  let x = oldLines.length;
  let y = newLines.length;
  const edits = [];

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      edits.push({
        type: 'equal', line: oldLines[x], oldIdx: x, newIdx: y,
      });
    }

    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        edits.push({ type: 'insert', line: newLines[y], newIdx: y });
      } else {
        x -= 1;
        edits.push({ type: 'delete', line: oldLines[x], oldIdx: x });
      }
    }
  }

  edits.reverse();
  return edits;
}

/**
 * Simple fallback for very large files.
 */
function simpleDiff(oldLines, newLines) {
  const edits = [];

  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length && ni < newLines.length) {
    if (oldLines[oi] === newLines[ni]) {
      edits.push({
        type: 'equal', line: oldLines[oi], oldIdx: oi, newIdx: ni,
      });
      oi += 1;
      ni += 1;
    } else {
      edits.push({ type: 'delete', line: oldLines[oi], oldIdx: oi });
      oi += 1;
    }
  }

  while (oi < oldLines.length) {
    edits.push({ type: 'delete', line: oldLines[oi], oldIdx: oi });
    oi += 1;
  }
  while (ni < newLines.length) {
    edits.push({ type: 'insert', line: newLines[ni], newIdx: ni });
    ni += 1;
  }

  return edits;
}

/**
 * @param {HTMLElement} parent
 * @param {Array} edits
 * @param {number} start
 * @param {number} end
 */
function buildOneHunk(edits, start, end) {
  const lines = [];
  let oldLine = null;
  let newLine = null;
  let oldCount = 0;
  let newCount = 0;

  for (let i = start; i <= end; i += 1) {
    const e = edits[i];
    if (e.type === 'equal') {
      const ol = e.oldIdx + 1;
      const nl = e.newIdx + 1;
      if (oldLine === null) {
        oldLine = ol;
      }
      if (newLine === null) {
        newLine = nl;
      }
      lines.push({
        type: 'context', content: e.line, oldLine: ol, newLine: nl,
      });
      oldCount += 1;
      newCount += 1;
    } else if (e.type === 'delete') {
      const ol = e.oldIdx + 1;
      if (oldLine === null) {
        oldLine = ol;
      }
      lines.push({ type: 'delete', content: e.line, oldLine: ol });
      oldCount += 1;
    } else {
      const nl = e.newIdx + 1;
      if (newLine === null) {
        newLine = nl;
      }
      lines.push({ type: 'add', content: e.line, newLine: nl });
      newCount += 1;
    }
  }

  return {
    oldStart: oldLine || 1,
    oldCount,
    newStart: newLine || 1,
    newCount,
    lines,
  };
}

/**
 * Minimal Myers diff producing a list of edit operations.
 *
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {Array<{type: string, line: string, oldIdx?: number, newIdx?: number}>}
 */
export function myersDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;

  if (max === 0) {
    return [];
  }

  // For very large files fall back to a simple LCS to avoid memory issues.
  if (max > 20000) {
    return simpleDiff(oldLines, newLines);
  }

  const vSize = 2 * max + 1;
  const v = new Int32Array(vSize).fill(-1);
  const offset = max;
  v[offset + 1] = 0;

  const trace = [];
  let done = false;

  for (let d = 0; d <= max && !done; d += 1) {
    const snap = new Int32Array(v);
    trace.push(snap);

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d
        || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }

  return backtrack(trace, offset, oldLines, newLines);
}

const CONTEXT_LINES = 3;

/**
 * Groups edit operations into unified-diff-style hunks with context.
 *
 * @param {Array<{type: string, line: string}>} edits
 * @returns {Array<{
 *   oldStart: number, oldCount: number,
 *   newStart: number, newCount: number,
 *   lines: Array,
 * }>}
 */
export function buildHunks(edits) {
  const changes = [];
  for (let i = 0; i < edits.length; i += 1) {
    if (edits[i].type !== 'equal') {
      changes.push(i);
    }
  }

  if (changes.length === 0) {
    return [];
  }

  const hunks = [];
  let hunkStart = null;
  let hunkEnd = null;

  for (const ci of changes) {
    const ctxStart = Math.max(0, ci - CONTEXT_LINES);
    const ctxEnd = Math.min(edits.length - 1, ci + CONTEXT_LINES);

    if (hunkStart === null) {
      hunkStart = ctxStart;
      hunkEnd = ctxEnd;
    } else if (ctxStart <= hunkEnd + 1) {
      hunkEnd = ctxEnd;
    } else {
      hunks.push(buildOneHunk(edits, hunkStart, hunkEnd));
      hunkStart = ctxStart;
      hunkEnd = ctxEnd;
    }
  }

  if (hunkStart !== null) {
    hunks.push(buildOneHunk(edits, hunkStart, hunkEnd));
  }

  return hunks;
}
