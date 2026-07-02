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
import { cloneIcon } from './icons.js';
import { entryDisplayLabel, getIconByExtension } from './entry-utils.js';

/**
 * @param {HTMLElement} container
 * @param {{
 *   cache: Record<string, object[]>,
 *   expanded: Set<string>,
 *   selectedPaths: Set<string>,
 *   icons: Record<string, SVGSVGElement>|null,
 *   error: string|null,
 *   authenticated: boolean,
 *   hasSite: boolean,
 *   onToggleFolder: (daPath: string) => void,
 *   onRowClick: (item: object, event: MouseEvent) => void,
 *   onRowDoubleClick: (item: object, event: MouseEvent) => void,
 *   onSyncSelected?: () => void,
 *   onPull?: () => void,
 *   onPush?: () => void,
 *   canPull?: boolean,
 *   hasPullChanges?: boolean,
 *   selectionCount?: number,
 * }} options
 */
export function renderFileTree(container, options) {
  const {
    error,
    authenticated,
    hasSite,
    selectionCount = 0,
  } = options;

  container.replaceChildren();

  if (hasSite && authenticated) {
    container.append(renderPanelHeader(selectionCount, options));
  }

  if (!hasSite) {
    container.append(createNotice('Select a site to browse files.', false, true));
    return;
  }

  if (!authenticated) {
    container.append(createNotice('Sign in to AEM to browse content.', false, true));
    return;
  }

  if (error) {
    container.append(createNotice(error, true));
  }

  const tree = document.createElement('ul');
  tree.className = 'tree';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Content');
  renderFolderChildren(tree, '/', 0, options);
  container.append(tree);
}

/**
 * @param {number} selectionCount
 * @param {object} options
 * @returns {HTMLElement}
 */
function renderPanelHeader(selectionCount, options) {
  const {
    onSyncSelected, onPull, onPush, hasPushChanges, hasPullChanges, canPull,
  } = options;
  const header = document.createElement('div');
  header.className = 'file-tree-header';

  const title = document.createElement('span');
  title.className = 'file-tree-title';
  title.textContent = 'Content';
  header.append(title);

  if (selectionCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'selection-badge';
    badge.textContent = String(selectionCount);
    badge.setAttribute('aria-label', `${selectionCount} selected`);
    header.append(badge);
  }

  const spacer = document.createElement('span');
  spacer.className = 'rail-header-spacer';
  header.append(spacer);

  const actions = document.createElement('div');
  actions.className = 'rail-header-actions';

  if (onPull) {
    const pullBtn = document.createElement('button');
    pullBtn.type = 'button';
    pullBtn.className = `s2-btn${hasPullChanges ? ' s2-btn-accent' : ''}`;
    pullBtn.textContent = 'Pull…';
    pullBtn.disabled = !canPull;
    if (!canPull) {
      pullBtn.title = 'Choose a local sync folder first';
    } else {
      pullBtn.removeAttribute('title');
    }
    pullBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPull();
    });
    actions.append(pullBtn);
  }

  if (onSyncSelected) {
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 's2-btn';
    syncBtn.textContent = 'Sync selected…';
    syncBtn.disabled = selectionCount === 0;
    if (selectionCount === 0) {
      syncBtn.title = 'Select files or folders in the tree to sync';
    } else {
      syncBtn.removeAttribute('title');
    }
    syncBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSyncSelected();
    });
    actions.append(syncBtn);
  }

  if (onPush) {
    const pushBtn = document.createElement('button');
    pushBtn.type = 'button';
    pushBtn.className = `s2-btn${hasPushChanges ? ' s2-btn-accent' : ''}`;
    pushBtn.textContent = 'Review changes…';
    pushBtn.disabled = !hasPushChanges;
    pushBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPush();
    });
    actions.append(pushBtn);
  }

  if (actions.childElementCount > 0) {
    header.append(actions);
  }

  return header;
}

/**
 * @param {HTMLElement} parent
 * @param {string} daPath
 * @param {number} depth
 * @param {object} options
 */
function renderFolderChildren(parent, daPath, depth, options) {
  const { cache } = options;

  const items = cache[daPath];
  if (!items) {
    return;
  }

  const folders = items.filter((i) => i.isFolder).sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter((i) => !i.isFolder).sort((a, b) => a.name.localeCompare(b.name));

  for (const item of folders) {
    parent.append(renderFolderRow(item, depth, options));
  }
  for (const item of files) {
    parent.append(renderFileRow(item, depth, options));
  }

  if (folders.length === 0 && files.length === 0) {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    li.append(createNotice('Empty folder'));
    parent.append(li);
  }
}

/**
 * @param {object} item
 * @param {boolean} isFolder
 * @param {number} depth
 * @param {object} options
 * @param {{ isExpanded?: boolean, onToggleFolder?: () => void }} rowOptions
 * @returns {HTMLLIElement}
 */
function renderTreeRow(item, isFolder, depth, options, rowOptions) {
  const {
    selectedPaths, icons, onRowClick, onRowDoubleClick,
    syncBadges,
  } = options;
  const { isExpanded = false, onToggleFolder } = rowOptions;
  const labelText = entryDisplayLabel(item);

  const li = document.createElement('li');
  li.setAttribute('role', 'none');

  const isSelected = selectedPaths.has(item.daPath);
  const row = document.createElement('div');
  row.className = `row${isSelected ? ' is-selected' : ''}`;
  row.setAttribute('role', 'treeitem');
  row.tabIndex = -1;
  row.dataset.daPath = item.daPath;
  row.dataset.folder = String(isFolder);
  if (isFolder) {
    row.setAttribute('aria-expanded', String(isExpanded));
  }
  if (isSelected) {
    row.setAttribute('aria-selected', 'true');
  }

  row.addEventListener('click', (event) => onRowClick(item, event));
  row.addEventListener('dblclick', (event) => onRowDoubleClick(item, event));

  const body = document.createElement('div');
  body.className = `row-body${isFolder ? '' : ' file'}`;
  body.style.setProperty('--depth', String(depth));

  if (isFolder) {
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggleFolder?.();
    });
    body.append(chevron);
  } else {
    const chevronSpacer = document.createElement('span');
    chevronSpacer.className = 'chevron-spacer';
    chevronSpacer.setAttribute('aria-hidden', 'true');
    body.append(chevronSpacer);
  }

  const iconSlot = document.createElement('span');
  iconSlot.className = 'entry-type';
  const iconKey = isFolder ? 'folder' : getIconByExtension(item.ext);
  const icon = cloneIcon(icons, iconKey);
  if (icon) {
    iconSlot.append(icon);
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = labelText;
  label.title = labelText;

  body.append(iconSlot, label);

  const badgeType = syncBadges?.get(item.daPath);
  if (badgeType) {
    const badge = document.createElement('span');
    badge.className = `sync-badge sync-badge-${badgeType}`;
    badge.textContent = badgeType;
    body.append(badge);
  }

  row.append(body);
  li.append(row);
  return li;
}

/**
 * @param {object} item
 * @param {number} depth
 * @param {object} options
 * @returns {HTMLLIElement}
 */
function renderFolderRow(item, depth, options) {
  const { expanded, onToggleFolder } = options;
  const isExpanded = expanded.has(item.daPath);

  const li = renderTreeRow(item, true, depth, options, {
    isExpanded,
    onToggleFolder: () => onToggleFolder(item.daPath),
  });

  if (isExpanded) {
    const group = document.createElement('ul');
    group.setAttribute('role', 'group');
    renderFolderChildren(group, item.daPath, depth + 1, options);
    li.append(group);
  }

  return li;
}

/**
 * @param {object} item
 * @param {number} depth
 * @param {object} options
 * @returns {HTMLLIElement}
 */
function renderFileRow(item, depth, options) {
  return renderTreeRow(item, false, depth, options, {});
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 * @param {boolean} [asPlaceholder]
 * @returns {HTMLParagraphElement}
 */
function createNotice(text, isError = false, asPlaceholder = false) {
  const p = document.createElement('p');
  if (isError) {
    p.className = 'notice error';
  } else if (asPlaceholder) {
    p.className = 'placeholder';
  } else {
    p.className = 'notice';
  }
  p.textContent = text;
  return p;
}
