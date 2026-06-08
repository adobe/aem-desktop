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
 * @param {string} value
 * @returns {string}
 */
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * @param {HTMLElement} item
 * @param {number} tabIndex
 */
function setTreeItemTabIndex(item, tabIndex) {
  // eslint-disable-next-line no-param-reassign
  item.tabIndex = tabIndex;
}

/**
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export function treeItems(root) {
  return [...root.querySelectorAll('[role="treeitem"]')];
}

/**
 * @param {ParentNode} root
 */
export function treeEnsureTabStop(root) {
  const items = treeItems(root);
  if (items.length && !items.some((el) => el.tabIndex === 0)) {
    setTreeItemTabIndex(items[0], 0);
  }
}

/**
 * @param {FocusEvent} event
 * @param {ParentNode} root
 */
export function treeFocusIn(event, root) {
  const item = /** @type {HTMLElement|null} */ (event.target.closest('[role="treeitem"]'));
  if (!item || !root.contains(item)) {
    return;
  }
  treeItems(root).forEach((el) => {
    setTreeItemTabIndex(el, el === item ? 0 : -1);
  });
}

/**
 * @param {HTMLElement} item
 * @param {ParentNode} root
 */
export function focusTreeItem(item, root) {
  treeItems(root).forEach((el) => {
    setTreeItemTabIndex(el, el === item ? 0 : -1);
  });
  item.focus();
}

/**
 * @param {ParentNode} root
 * @param {string} daPath
 * @returns {HTMLElement|null}
 */
export function treeItemByPath(root, daPath) {
  return root.querySelector(`[role="treeitem"][data-da-path="${cssEscape(daPath)}"]`);
}

/**
 * @param {ParentNode} root
 * @param {string} daPath
 */
export function focusTreeItemByPath(root, daPath) {
  const item = treeItemByPath(root, daPath);
  if (item) {
    focusTreeItem(item, root);
  }
}

/**
 * @param {ParentNode} root
 * @param {string} folderDaPath
 */
export function focusFirstChildTreeItem(root, folderDaPath) {
  const folder = treeItemByPath(root, folderDaPath);
  if (!folder) {
    return;
  }
  const li = folder.closest('li[role="none"]');
  const child = li?.querySelector(':scope > [role="group"] [role="treeitem"]');
  if (child instanceof HTMLElement) {
    focusTreeItem(child, root);
  }
}

/**
 * @param {HTMLElement} item
 * @returns {HTMLElement|null}
 */
function parentTreeItem(item) {
  const group = item.closest('[role="group"]');
  if (!group) {
    return null;
  }
  const li = group.closest('li[role="none"]');
  const parent = li?.querySelector(':scope > [role="treeitem"]');
  return parent instanceof HTMLElement ? parent : null;
}

/**
 * @param {HTMLElement} item
 * @returns {HTMLElement|null}
 */
function firstChildTreeItem(item) {
  const li = item.closest('li[role="none"]');
  const child = li?.querySelector(':scope > [role="group"] [role="treeitem"]');
  return child instanceof HTMLElement ? child : null;
}

/**
 * @param {HTMLElement} item
 * @returns {boolean}
 */
function isFolderItem(item) {
  return item.dataset.folder === 'true';
}

/**
 * @param {HTMLElement} item
 * @returns {boolean}
 */
function isExpandedItem(item) {
  return item.getAttribute('aria-expanded') === 'true';
}

/**
 * @param {KeyboardEvent} event
 * @param {ParentNode} root
 * @param {{
 *   onActivate?: (item: HTMLElement) => void,
 *   onExpand?: (item: HTMLElement) => void,
 *   onCollapse?: (item: HTMLElement) => void,
 *   onFocusMove?: (item: HTMLElement, event: KeyboardEvent) => void,
 * }} handlers
 */
export function treeKeydown(event, root, handlers) {
  const items = treeItems(root);
  if (!items.length) {
    return;
  }

  const current = document.activeElement?.closest('[role="treeitem"]');
  if (!(current instanceof HTMLElement) || !root.contains(current)) {
    return;
  }

  const idx = items.indexOf(current);
  if (idx === -1) {
    return;
  }

  const { key } = event;

  if (key === 'ArrowDown') {
    event.preventDefault();
    if (idx < items.length - 1) {
      const next = items[idx + 1];
      focusTreeItem(next, root);
      handlers.onFocusMove?.(next, event);
    }
    return;
  }

  if (key === 'ArrowUp') {
    event.preventDefault();
    if (idx > 0) {
      const prev = items[idx - 1];
      focusTreeItem(prev, root);
      handlers.onFocusMove?.(prev, event);
    }
    return;
  }

  if (key === 'Home') {
    event.preventDefault();
    focusTreeItem(items[0], root);
    handlers.onFocusMove?.(items[0], event);
    return;
  }

  if (key === 'End') {
    event.preventDefault();
    const last = items[items.length - 1];
    focusTreeItem(last, root);
    handlers.onFocusMove?.(last, event);
    return;
  }

  if (key === 'ArrowRight') {
    event.preventDefault();
    if (isFolderItem(current)) {
      if (!isExpandedItem(current)) {
        handlers.onExpand?.(current);
      } else {
        const child = firstChildTreeItem(current);
        if (child) {
          focusTreeItem(child, root);
          handlers.onFocusMove?.(child, event);
        }
      }
    }
    return;
  }

  if (key === 'ArrowLeft') {
    event.preventDefault();
    if (isFolderItem(current) && isExpandedItem(current)) {
      handlers.onCollapse?.(current);
    } else {
      const parent = parentTreeItem(current);
      if (parent) {
        focusTreeItem(parent, root);
        handlers.onFocusMove?.(parent, event);
      }
    }
    return;
  }

  if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    handlers.onActivate?.(current);
  }
}
