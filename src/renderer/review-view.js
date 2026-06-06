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

import { displayPath } from './entry-utils.js';

function badgeClass(status) {
  const map = { modified: 'modified', new: 'new', deleted: 'deleted' };
  return map[status] || 'modified';
}

/**
 * Renders the file list in the review rail.
 *
 * @param {HTMLElement} container
 * @param {Array<{daPath: string, status: string, additions: number, deletions: number}>} files
 * @param {string|null} selectedPath
 * @param {(daPath: string) => void} onSelect
 */
export function renderReviewFileList(container, files, selectedPath, onSelect) {
  container.replaceChildren();

  if (files.length === 0) {
    const p = document.createElement('p');
    p.className = 'review-empty';
    p.textContent = 'No changes to review.';
    container.append(p);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'review-file-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Changed files');
  list.tabIndex = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const isSelected = file.daPath === selectedPath;
    const li = document.createElement('li');
    li.className = `review-file-row${isSelected ? ' is-selected' : ''}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(isSelected));
    li.dataset.daPath = file.daPath;
    li.dataset.index = String(i);
    li.addEventListener('click', () => onSelect(file.daPath));

    const pathSpan = document.createElement('span');
    pathSpan.className = 'review-file-path';
    pathSpan.textContent = displayPath(file.daPath);
    pathSpan.title = file.daPath;

    const meta = document.createElement('span');
    meta.className = 'review-file-meta';

    const badge = document.createElement('span');
    badge.className = `sync-badge sync-badge-${badgeClass(file.status)}`;
    badge.textContent = file.status;

    const stats = document.createElement('span');
    stats.className = 'review-file-stats';
    if (file.additions > 0) {
      const add = document.createElement('span');
      add.className = 'stat-add';
      add.textContent = `+${file.additions}`;
      stats.append(add);
    }
    if (file.deletions > 0) {
      const del = document.createElement('span');
      del.className = 'stat-del';
      del.textContent = `−${file.deletions}`;
      stats.append(del);
    }

    meta.append(stats, badge);
    li.append(pathSpan, meta);
    list.append(li);
  }

  container.append(list);

  if (selectedPath) {
    list.focus({ preventScroll: true });
    const sel = list.querySelector('[aria-selected="true"]');
    if (sel) {
      sel.scrollIntoView({ block: 'nearest' });
    }
  }
}

/**
 * Attaches keyboard navigation to the review file list container.
 * Call once — the listener lives on the stable container element.
 *
 * @param {HTMLElement} container
 * @param {Array<{daPath: string}>} filesRef  — mutable ref; update `.files`
 * @param {(daPath: string) => void} onSelect
 */
export function wireReviewKeyboard(container, filesRef, onSelect) {
  container.addEventListener('keydown', (event) => {
    const list = container.querySelector('[role="listbox"]');
    if (!list) {
      return;
    }
    const rows = [...list.querySelectorAll('[role="option"]')];
    if (rows.length === 0) {
      return;
    }
    const currentIdx = rows.findIndex(
      (r) => r.getAttribute('aria-selected') === 'true',
    );
    let nextIdx = currentIdx;

    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx;
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
    } else if (event.key === 'Home') {
      event.preventDefault();
      nextIdx = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      nextIdx = rows.length - 1;
    } else {
      return;
    }

    if (nextIdx !== currentIdx && rows[nextIdx]) {
      onSelect(rows[nextIdx].dataset.daPath);
    }
  });
}

/**
 * Renders a GitHub-style unified diff into the given container.
 *
 * @param {HTMLElement} container
 * @param {{ daPath: string, status: string, hunks: Array }} file
 */
export function renderDiffView(container, file) {
  container.replaceChildren();

  if (!file) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = 'Select a file to see changes.';
    container.append(p);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'diff-wrapper';

  if (file.hunks.length === 0) {
    const p = document.createElement('p');
    p.className = 'diff-empty';
    if (file.status === 'new') {
      p.textContent = 'New file (binary or empty).';
    } else if (file.status === 'deleted') {
      p.textContent = 'File deleted.';
    } else {
      p.textContent = 'No textual changes.';
    }
    wrapper.append(p);
    container.append(wrapper);
    return;
  }

  const table = document.createElement('table');
  table.className = 'diff-table';

  for (const hunk of file.hunks) {
    const hunkHeaderTr = document.createElement('tr');
    hunkHeaderTr.className = 'diff-hunk-header';
    const hunkTd = document.createElement('td');
    hunkTd.colSpan = 3;
    hunkTd.textContent = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    hunkHeaderTr.append(hunkTd);
    table.append(hunkHeaderTr);

    for (const line of hunk.lines) {
      const tr = document.createElement('tr');
      tr.className = `diff-line diff-line-${line.type}`;

      const oldNum = document.createElement('td');
      oldNum.className = 'diff-line-num diff-line-num-old';
      oldNum.textContent = line.oldLine != null ? String(line.oldLine) : '';

      const newNum = document.createElement('td');
      newNum.className = 'diff-line-num diff-line-num-new';
      newNum.textContent = line.newLine != null ? String(line.newLine) : '';

      const content = document.createElement('td');
      content.className = 'diff-line-content';

      const prefix = document.createElement('span');
      prefix.className = 'diff-prefix';
      if (line.type === 'add') {
        prefix.textContent = '+';
      } else if (line.type === 'delete') {
        prefix.textContent = '−';
      } else {
        prefix.textContent = ' ';
      }

      const code = document.createElement('span');
      code.textContent = line.content;

      content.append(prefix, code);
      tr.append(oldNum, newNum, content);
      table.append(tr);
    }
  }

  wrapper.append(table);
  container.append(wrapper);
}
