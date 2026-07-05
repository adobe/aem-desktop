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
 * @typedef {{ cells: string[] }} DocumentRow
 * @typedef {{
 *   kind: 'table',
 *   name: string,
 *   rows: DocumentRow[],
 *   colSpan: number,
 * }} DocumentTableBlock
 * @typedef {{ kind: 'content', html: string }} DocumentContentBlock
 * @typedef {DocumentTableBlock | DocumentContentBlock} DocumentBlock
 * @typedef {{ blocks: DocumentBlock[] }} DocumentSection
 * @typedef {{ sections: DocumentSection[] }} DocumentView
 */

/**
 * @param {DocumentTableBlock} block
 * @returns {HTMLDivElement}
 */
function createTableWrapper(block) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tableWrapper';

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');

  const headerRow = document.createElement('tr');
  const headerCell = document.createElement('td');
  if (block.colSpan > 1) {
    headerCell.colSpan = block.colSpan;
  }
  headerCell.textContent = block.name;
  headerRow.append(headerCell);
  tbody.append(headerRow);

  for (const row of block.rows) {
    const tr = document.createElement('tr');
    if (row.change && row.change !== 'unchanged') {
      tr.classList.add(`da-diff-row-${row.change}`);
    }
    for (let i = 0; i < row.cells.length; i += 1) {
      const td = document.createElement('td');
      td.innerHTML = row.cells[i];
      if (row.cells.length < block.colSpan && i === row.cells.length - 1) {
        td.colSpan = block.colSpan - i;
      }
      tr.append(td);
    }
    tbody.append(tr);
  }

  table.append(tbody);
  wrapper.append(table);
  return wrapper;
}

/**
 * @param {DocumentContentBlock} block
 * @returns {HTMLDivElement}
 */
function createContentBlock(block) {
  const el = document.createElement('div');
  el.className = 'da-document-content';
  el.innerHTML = block.html;
  return el;
}

/**
 * Renders a track-changes document diff (see `document-view-diff.js` in the
 * main process): blocks and section breaks marked added/removed/modified,
 * with inline `<ins>`/`<del>` markup inside modified content.
 *
 * @param {HTMLElement} container
 * @param {{ changed: boolean, items: Array }|null} model
 * @param {string} [emptyMessage]
 */
export function renderDocumentDiffView(container, model, emptyMessage = 'No document content.') {
  container.replaceChildren();
  container.classList.add('document-view');

  if (!model || model.items.length === 0) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = emptyMessage;
    container.append(p);
    return;
  }

  const prose = document.createElement('div');
  prose.className = 'da-document-view da-document-diff';

  for (const item of model.items) {
    if (item.kind === 'break') {
      const hr = document.createElement('hr');
      if (item.change !== 'unchanged') {
        hr.classList.add(`da-diff-break-${item.change}`);
      }
      prose.append(hr);
    } else {
      const el = item.kind === 'table'
        ? createTableWrapper(item)
        : createContentBlock(item);
      if (item.change !== 'unchanged') {
        el.classList.add(`da-diff-${item.change}`);
      }
      prose.append(el);
    }
  }

  container.append(prose);
}

/**
 * @param {HTMLElement} container
 * @param {DocumentView|null} model
 * @param {string} [emptyMessage]
 */
export function renderDocumentView(container, model, emptyMessage = 'No document content.') {
  container.replaceChildren();
  container.classList.add('document-view');

  if (!model || model.sections.every((s) => s.blocks.length === 0)) {
    const p = document.createElement('p');
    p.className = 'placeholder';
    p.textContent = emptyMessage;
    container.append(p);
    return;
  }

  const prose = document.createElement('div');
  prose.className = 'da-document-view';

  model.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      prose.append(document.createElement('hr'));
    }

    for (const block of section.blocks) {
      if (block.kind === 'table') {
        prose.append(createTableWrapper(block));
      } else {
        prose.append(createContentBlock(block));
      }
    }
  });

  container.append(prose);
}
