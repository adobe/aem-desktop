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

import { loadIcons } from './icons.js';
import { displayPath } from './entry-utils.js';
import { renderFileTree } from './file-tree.js';
import {
  applyFinderClick,
  collectVisibleItems,
  selectAllPaths,
} from './tree-selection.js';
import {
  focusFirstChildTreeItem,
  focusTreeItemByPath,
  treeEnsureTabStop,
  treeFocusIn,
  treeKeydown,
} from './tree-nav.js';
import {
  renderReviewFileList, renderDiffView, wireReviewKeyboard,
  togglePathsCheckState,
} from './review-view.js';

const state = {
  view: 'home',
  sites: [],
  activeSiteId: null,
  authenticated: false,
  icons: null,
  tree: {
    cache: {},
    expanded: new Set(['/']),
    selectedPaths: new Set(),
    anchorPath: null,
    openedDaPath: null,
    error: null,
    focusAfterPaint: null,
    syncBadges: new Map(),
    hasPushChanges: false,
  },
};

const els = {
  app: document.getElementById('app'),
  siteNav: document.getElementById('site-nav'),
  navHome: document.getElementById('nav-home'),
  navOrg: document.getElementById('nav-org'),
  navRepo: document.getElementById('nav-repo'),
  navBranch: document.getElementById('nav-branch'),
  homeView: document.getElementById('home-view'),
  browseView: document.getElementById('browse-view'),
  siteList: document.getElementById('site-list'),
  addSiteForm: document.getElementById('add-site-form'),
  addSiteToggle: document.getElementById('add-site-toggle'),
  addSiteCancel: document.getElementById('add-site-cancel'),
  siteUrlInput: document.getElementById('site-url-input'),
  addSiteError: document.getElementById('add-site-error'),
  fileTree: document.getElementById('file-tree'),
  authStatus: document.getElementById('auth-status'),
  signInBtn: document.getElementById('sign-in-btn'),
  signOutBtn: document.getElementById('sign-out-btn'),
  contentBody: document.getElementById('content-body'),
  syncModal: document.getElementById('sync-modal'),
  syncPickFolder: document.getElementById('sync-pick-folder'),
  syncFolderPath: document.getElementById('sync-folder-path'),
  syncIncludeBinaries: document.getElementById('sync-include-binaries'),
  syncStart: document.getElementById('sync-start'),
  syncCancel: document.getElementById('sync-cancel'),
  syncSelectionList: document.getElementById('sync-selection-list'),
  syncSelectionSummary: document.getElementById('sync-selection-summary'),
  syncProgress: document.getElementById('sync-progress'),
  syncProgressFill: document.getElementById('sync-progress-fill'),
  syncProgressText: document.getElementById('sync-progress-text'),
  syncReveal: document.getElementById('sync-reveal'),
  syncStatus: document.getElementById('sync-status'),
  syncLocalNew: document.getElementById('sync-local-new'),
  syncLocalNewText: document.getElementById('sync-local-new-text'),
  syncDeletedLocally: document.getElementById('sync-deleted-locally'),
  syncDeletedLocallyText: document.getElementById('sync-deleted-locally-text'),
  syncLocalOnly: document.getElementById('sync-local-only'),
  syncLocalOnlyText: document.getElementById('sync-local-only-text'),
  syncModifiedWarning: document.getElementById('sync-modified-warning'),
  syncModifiedList: document.getElementById('sync-modified-list'),
  syncOverwriteModified: document.getElementById('sync-overwrite-modified'),
  syncConflictWarning: document.getElementById('sync-conflict-warning'),
  syncConflictText: document.getElementById('sync-conflict-text'),
  syncOverwriteConflicts: document.getElementById('sync-overwrite-conflicts'),
  reviewView: document.getElementById('review-view'),
  reviewFileContainer: document.getElementById('review-file-container'),
  reviewDiffBody: document.getElementById('review-diff-body'),
  reviewCancel: document.getElementById('review-cancel'),
  reviewPush: document.getElementById('review-push'),
  reviewProgress: document.getElementById('review-progress'),
  reviewProgressFill: document.getElementById('review-progress-fill'),
  reviewProgressText: document.getElementById('review-progress-text'),
};

function activeSite() {
  return state.sites.find((site) => site.id === state.activeSiteId) ?? null;
}

function renderNav() {
  const site = activeSite();
  if (!site || (state.view !== 'browse' && state.view !== 'review')) {
    return;
  }
  els.navOrg.textContent = site.org;
  els.navRepo.textContent = site.repo;
  els.navBranch.textContent = site.branch;
}

function showView(view) {
  state.view = view;

  els.app.classList.toggle('is-browse', view === 'browse' || view === 'review');

  hide(els.homeView);
  hide(els.browseView);
  hide(els.reviewView);
  hide(els.siteNav);

  if (view === 'browse') {
    show(els.browseView);
    show(els.siteNav);
    renderNav();
  } else if (view === 'review') {
    show(els.reviewView);
    show(els.siteNav);
    renderNav();
  } else {
    show(els.homeView);
  }
}

function goHome() {
  showView('home');
  renderSites();
}

async function enterBrowse(siteId) {
  if (!state.authenticated) {
    return;
  }
  state.activeSiteId = siteId;
  resetTree();
  renderContentPlaceholder('Select a file from the folder list.');
  showView('browse');
  renderSites();
  await refreshTree();
}

function show(element) {
  element.classList.remove('hidden');
  // eslint-disable-next-line no-param-reassign
  element.hidden = false;
}

function hide(element) {
  element.classList.add('hidden');
  // eslint-disable-next-line no-param-reassign
  element.hidden = true;
}

function setError(message) {
  if (message) {
    els.addSiteError.textContent = message;
    show(els.addSiteError);
  } else {
    hide(els.addSiteError);
  }
}

function siteLabel(site) {
  return `${site.org}/${site.repo}`;
}

function resetTree() {
  state.tree = {
    cache: {},
    expanded: new Set(['/']),
    selectedPaths: new Set(),
    anchorPath: null,
    openedDaPath: null,
    error: null,
    focusAfterPaint: null,
    syncBadges: new Map(),
  };
}

function visiblePaths() {
  return collectVisibleItems(state.tree.cache, state.tree.expanded).map((item) => item.daPath);
}

function handleRowClick(item, event) {
  const paths = visiblePaths();
  const { selectedPaths, anchorPath } = applyFinderClick({
    visiblePaths: paths,
    selectedPaths: state.tree.selectedPaths,
    anchorPath: state.tree.anchorPath,
    daPath: item.daPath,
    metaKey: event.metaKey || event.ctrlKey,
    shiftKey: event.shiftKey,
  });
  state.tree.selectedPaths = selectedPaths;
  state.tree.anchorPath = anchorPath;
  state.tree.focusAfterPaint = { daPath: item.daPath };
  paintFileTree();

  if (!item.isFolder && state.tree.selectedPaths.size === 1) {
    previewFile(item);
  }
}

function handleRowDoubleClick(item) {
  if (item.isFolder) {
    toggleFolder(item.daPath);
    return;
  }
  previewFile(item);
}

function selectAllVisibleItems() {
  state.tree.selectedPaths = selectAllPaths(visiblePaths());
  if (state.tree.selectedPaths.size > 0) {
    const [firstPath] = visiblePaths();
    state.tree.anchorPath = firstPath;
  }
  paintFileTree();
}

function renderAuthStatus() {
  if (state.authenticated) {
    els.authStatus.textContent = 'Signed in to DA';
    els.authStatus.classList.add('ok');
    hide(els.signInBtn);
    show(els.signOutBtn);
  } else {
    els.authStatus.textContent = 'Sign in to DA to open a site';
    els.authStatus.classList.remove('ok');
    show(els.signInBtn);
    hide(els.signOutBtn);
  }
  renderSites();
}

let previewWebview = null;
let previewOrigin = null;

function destroyPreviewWebview() {
  if (previewWebview) {
    previewWebview.remove();
    previewWebview = null;
    previewOrigin = null;
  }
}

function renderContentPlaceholder(message) {
  els.contentBody.classList.remove('is-preview');
  destroyPreviewWebview();
  els.contentBody.replaceChildren();
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = message;
  els.contentBody.append(p);
}

function samePreviewOrigin(origin, url) {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function ensurePreviewWebview(previewUrlOrigin) {
  if (previewWebview && previewOrigin === previewUrlOrigin) {
    return previewWebview;
  }

  destroyPreviewWebview();
  els.contentBody.replaceChildren();

  const webview = document.createElement('webview');
  webview.className = 'preview-webview';
  webview.setAttribute('allowpopups', 'false');

  webview.addEventListener('will-navigate', (event) => {
    if (!samePreviewOrigin(previewUrlOrigin, event.url)) {
      event.preventDefault();
      window.aemDesktop.openExternal(event.url);
    }
  });

  webview.addEventListener('new-window', (event) => {
    event.preventDefault();
    window.aemDesktop.openExternal(event.url);
  });

  els.contentBody.append(webview);
  previewWebview = webview;
  previewOrigin = previewUrlOrigin;
  return webview;
}

function showPreview({ url, previewUrlOrigin }) {
  els.contentBody.classList.add('is-preview');

  const webview = ensurePreviewWebview(previewUrlOrigin);
  webview.src = url;
}

function findItemInCache(daPath) {
  const parentPath = daPath.lastIndexOf('/') > 0
    ? daPath.slice(0, daPath.lastIndexOf('/'))
    : '/';
  return state.tree.cache[parentPath]?.find((entry) => entry.daPath === daPath);
}

function paintFileTree() {
  const treeEl = els.fileTree.querySelector('[role="tree"]');
  const focusedPath = treeEl?.querySelector('[role="treeitem"][tabindex="0"]')?.dataset.daPath ?? null;

  renderFileTree(els.fileTree, {
    cache: state.tree.cache,
    expanded: state.tree.expanded,
    selectedPaths: state.tree.selectedPaths,
    icons: state.icons,
    error: state.tree.error,
    authenticated: state.authenticated,
    hasSite: Boolean(state.activeSiteId),
    onToggleFolder: toggleFolder,
    onRowClick: handleRowClick,
    onRowDoubleClick: handleRowDoubleClick,
    onPull: openSyncModal,
    onPush: openPushModal,
    selectionCount: state.tree.selectedPaths.size,
    syncBadges: state.tree.syncBadges,
    hasPushChanges: state.tree.hasPushChanges,
  });

  const tree = els.fileTree.querySelector('[role="tree"]');
  if (!tree) {
    return;
  }

  treeEnsureTabStop(tree);

  const pending = state.tree.focusAfterPaint;
  state.tree.focusAfterPaint = null;

  if (pending?.type === 'firstChild') {
    focusFirstChildTreeItem(tree, pending.daPath);
  } else if (pending?.daPath) {
    focusTreeItemByPath(tree, pending.daPath);
  } else if (focusedPath) {
    focusTreeItemByPath(tree, focusedPath);
  }
}

async function loadFolder(daPath) {
  if (!state.activeSiteId || !state.authenticated) {
    return;
  }

  state.tree.error = null;

  try {
    const items = await window.aemDesktop.listDa(state.activeSiteId, daPath);
    state.tree.cache[daPath] = items;
    injectLocalFilesForFolder(daPath);
  } catch (err) {
    if (daPath === '/') {
      state.tree.error = err.message || 'Failed to list folder';
    }
  } finally {
    paintFileTree();
  }
}

async function toggleFolder(daPath) {
  if (state.tree.expanded.has(daPath) && state.tree.cache[daPath]) {
    state.tree.expanded.delete(daPath);
    state.tree.focusAfterPaint = { daPath };
    paintFileTree();
    return;
  }

  state.tree.expanded.add(daPath);
  state.tree.focusAfterPaint = { daPath };
  if (!state.tree.cache[daPath]) {
    await loadFolder(daPath);
    return;
  }
  paintFileTree();
}

async function expandFolder(daPath, { focusFirstChild = false } = {}) {
  if (state.tree.expanded.has(daPath) && state.tree.cache[daPath]) {
    if (focusFirstChild) {
      state.tree.focusAfterPaint = { type: 'firstChild', daPath };
      paintFileTree();
    }
    return;
  }

  state.tree.expanded.add(daPath);
  state.tree.focusAfterPaint = focusFirstChild
    ? { type: 'firstChild', daPath }
    : { daPath };

  if (!state.tree.cache[daPath]) {
    await loadFolder(daPath);
    return;
  }
  paintFileTree();
}

function collapseFolder(daPath) {
  if (!state.tree.expanded.has(daPath)) {
    return;
  }
  state.tree.expanded.delete(daPath);
  state.tree.focusAfterPaint = { daPath };
  paintFileTree();
}

async function refreshTree() {
  paintFileTree();
  if (state.activeSiteId && state.authenticated) {
    await loadFolder('/');
    autoSyncCheck();
  }
}

async function hardRefresh() {
  if (!state.activeSiteId || !state.authenticated) {
    return;
  }
  const expanded = [...state.tree.expanded];
  state.tree.cache = {};
  state.tree.syncBadges = new Map();

  if (previewWebview) {
    previewWebview.reloadIgnoringCache();
  }

  for (const daPath of expanded) {
    await loadFolder(daPath); // eslint-disable-line no-await-in-loop
  }
  autoSyncCheck();
}

function autoSyncCheck() {
  if (!syncFolder || !state.activeSiteId || !state.authenticated) {
    return;
  }
  const siteId = state.activeSiteId;
  window.aemDesktop.checkSync({
    siteId,
    items: [{ daPath: '/', isFolder: true }],
    destFolder: syncFolder,
    includeBinaries: true,
  }).then((status) => {
    if (state.activeSiteId !== siteId) {
      return;
    }
    buildSyncBadges(status);
  }).catch(() => {});

  window.aemDesktop.checkPush({
    siteId,
    destFolder: syncFolder,
  }).then((ps) => {
    if (state.activeSiteId !== siteId) {
      return;
    }
    const hasChanges = ps.modified.length > 0
      || ps.localNew.length > 0
      || ps.deleted.length > 0;
    state.tree.hasPushChanges = hasChanges;
    paintFileTree();
  }).catch(() => {});
}

async function refreshAuthStatus() {
  try {
    const status = await window.aemDesktop.getDaAuthStatus();
    state.authenticated = status.authenticated;
  } catch {
    state.authenticated = false;
  }
  renderAuthStatus();
  if (!state.authenticated && state.view === 'browse') {
    goHome();
  }
}

async function selectSite(siteId) {
  if (!state.authenticated) {
    return;
  }
  await enterBrowse(siteId);
}

async function removeSite(siteId) {
  state.sites = await window.aemDesktop.removeSite(siteId);
  if (state.activeSiteId === siteId) {
    state.activeSiteId = null;
    resetTree();
    if (state.view === 'browse') {
      goHome();
    }
  }
  renderSites();
}

async function previewFile(item) {
  if (!state.activeSiteId || item.isFolder) {
    return;
  }

  const site = activeSite();
  if (!site) {
    return;
  }

  state.tree.openedDaPath = item.daPath;

  try {
    const preview = await window.aemDesktop.buildPreviewUrl(state.activeSiteId, item.daPath);
    showPreview({
      daPath: item.daPath,
      url: preview.url,
      previewPath: preview.previewPath,
      previewUrlOrigin: site.previewUrl,
    });
  } catch (err) {
    renderContentPlaceholder(err.message || 'Failed to load preview');
  }
}

function renderSites() {
  els.siteList.replaceChildren();

  if (state.sites.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'No sites yet. Add an .aem.page URL to get started.';
    els.siteList.append(li);
    return;
  }

  for (const site of state.sites) {
    const li = document.createElement('li');
    li.className = 'site-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-btn';
    btn.disabled = !state.authenticated;
    btn.title = state.authenticated ? '' : 'Sign in to DA to open this site';
    btn.innerHTML = `<span class="site-name">${siteLabel(site)}</span><span class="site-branch">${site.branch}</span>`;
    btn.addEventListener('click', () => selectSite(site.id));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-icon remove-site';
    removeBtn.title = 'Remove site';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSite(site.id);
    });

    li.append(btn, removeBtn);
    els.siteList.append(li);
  }
}

async function loadSites() {
  state.sites = await window.aemDesktop.listSites();
  if (state.activeSiteId && !state.sites.find((s) => s.id === state.activeSiteId)) {
    state.activeSiteId = null;
    if (state.view === 'browse') {
      goHome();
    }
  }
  renderSites();
  if (state.view === 'browse' && state.activeSiteId) {
    await refreshTree();
  }
}

async function handleAddSite(event) {
  event.preventDefault();
  setError('');

  const url = els.siteUrlInput.value.trim();
  if (!url) {
    return;
  }

  try {
    const site = await window.aemDesktop.addSite(url);
    state.sites = await window.aemDesktop.listSites();
    els.siteUrlInput.value = '';
    hide(els.addSiteForm);
    if (state.authenticated) {
      await enterBrowse(site.id);
    }
  } catch (err) {
    setError(err.message || 'Failed to add site');
  }
}

async function handleSignOut() {
  els.signOutBtn.disabled = true;
  try {
    const status = await window.aemDesktop.logoutDa();
    state.authenticated = status.authenticated;
    renderAuthStatus();
    if (state.view === 'browse') {
      goHome();
    }
  } catch (err) {
    els.authStatus.textContent = err.message || 'Sign-out failed';
    els.authStatus.classList.remove('ok');
  } finally {
    els.signOutBtn.disabled = false;
  }
}

async function handleSignIn() {
  els.signInBtn.disabled = true;
  els.authStatus.textContent = 'Signing in…';
  try {
    const status = await window.aemDesktop.loginDa();
    state.authenticated = status.authenticated;
    renderAuthStatus();
    if (state.view === 'browse') {
      await refreshTree();
    }
  } catch (err) {
    els.authStatus.textContent = err.message || 'Sign-in failed';
    state.authenticated = false;
    renderAuthStatus();
  } finally {
    els.signInBtn.disabled = false;
  }
}

let syncFolder = localStorage.getItem('syncFolder') || null;
let syncing = false;
let syncedPath = null;
let syncConflicts = [];
let syncUnchanged = [];
let syncModified = [];
let syncTotalFiles = 0;
let syncRequiresModifiedAck = false;
let syncRequiresConflictAck = false;
let removeSyncProgressListener = null;

function renderSyncPathList(listEl, paths) {
  listEl.replaceChildren();
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  for (const daPath of sorted) {
    const li = document.createElement('li');
    li.textContent = displayPath(daPath);
    li.title = daPath;
    listEl.append(li);
  }
}

function renderSyncSelectionList() {
  const items = getSelectedItems();
  els.syncSelectionList.replaceChildren();
  const sorted = [...items].sort((a, b) => a.daPath.localeCompare(b.daPath));
  for (const item of sorted) {
    const li = document.createElement('li');
    li.textContent = item.isFolder
      ? `${displayPath(item.daPath)}/`
      : displayPath(item.daPath);
    li.title = item.daPath;
    els.syncSelectionList.append(li);
  }
}

function updateSyncStartEnabled() {
  if (syncing || !syncFolder || syncTotalFiles === 0) {
    els.syncStart.disabled = true;
    return;
  }
  if (syncRequiresModifiedAck && !els.syncOverwriteModified.checked) {
    els.syncStart.disabled = true;
    return;
  }
  if (syncRequiresConflictAck && !els.syncOverwriteConflicts.checked) {
    els.syncStart.disabled = true;
    return;
  }
  els.syncStart.disabled = false;
}

function getSelectedItems() {
  const items = [];
  for (const daPath of state.tree.selectedPaths) {
    const item = findItemInCache(daPath);
    if (item) {
      items.push({
        daPath: item.daPath,
        isFolder: item.isFolder,
        ext: item.ext,
        lastModified: item.lastModified,
      });
    }
  }
  return items;
}

function pluralFiles(n) {
  return `${n} file${n === 1 ? '' : 's'}`;
}

function resetSyncModalState() {
  syncedPath = null;
  syncConflicts = [];
  syncUnchanged = [];
  syncModified = [];
  hide(els.syncProgress);
  hide(els.syncReveal);
  hide(els.syncStatus);
  hide(els.syncLocalNew);
  hide(els.syncDeletedLocally);
  hide(els.syncLocalOnly);
  hide(els.syncModifiedWarning);
  hide(els.syncConflictWarning);
  els.syncOverwriteModified.checked = false;
  els.syncOverwriteConflicts.checked = false;
  syncTotalFiles = 0;
  syncRequiresModifiedAck = false;
  syncRequiresConflictAck = false;
  els.syncSelectionSummary.textContent = '';
  els.syncModifiedList.replaceChildren();
  els.syncProgressFill.style.width = '0%';
  els.syncProgressText.textContent = '';
  els.syncStart.textContent = 'Sync';
  els.syncCancel.textContent = 'Cancel';
  syncing = false;
}

function updateSyncFolderDisplay() {
  if (syncFolder) {
    els.syncFolderPath.textContent = syncFolder;
    els.syncFolderPath.title = syncFolder;
    els.syncFolderPath.classList.remove('no-folder');
    els.syncPickFolder.textContent = 'Change…';
  } else {
    els.syncFolderPath.textContent = 'No folder selected';
    els.syncFolderPath.title = '';
    els.syncFolderPath.classList.add('no-folder');
    els.syncPickFolder.textContent = 'Choose folder…';
  }
}

function renderSyncStatus(status) {
  const parts = [];
  if (status.newCount > 0) {
    parts.push(`${pluralFiles(status.newCount)} not yet synced`);
  }
  if (status.outdatedCount > 0) {
    parts.push(`${pluralFiles(status.outdatedCount)} outdated`);
  }
  if (status.modifiedCount > 0) {
    parts.push(`${pluralFiles(status.modifiedCount)} modified locally`);
  }
  if (status.unchangedCount > 0) {
    parts.push(`${pluralFiles(status.unchangedCount)} up to date`);
  }

  if (parts.length > 0) {
    els.syncStatus.textContent = parts.join(', ');
    show(els.syncStatus);
  } else {
    hide(els.syncStatus);
  }

  if (status.localNewCount > 0) {
    els.syncLocalNewText.textContent = `${pluralFiles(status.localNewCount)} created locally (not on remote).`;
    show(els.syncLocalNew);
  } else {
    hide(els.syncLocalNew);
  }

  if (status.deletedLocallyCount > 0) {
    els.syncDeletedLocallyText.textContent = `${pluralFiles(status.deletedLocallyCount)} deleted locally — will be re-downloaded.`;
    show(els.syncDeletedLocally);
  } else {
    hide(els.syncDeletedLocally);
  }

  if (status.localOnlyCount > 0) {
    els.syncLocalOnlyText.textContent = `${pluralFiles(status.localOnlyCount)} only exist locally (removed from remote).`;
    show(els.syncLocalOnly);
  } else {
    hide(els.syncLocalOnly);
  }

  if (status.conflictCount > 0) {
    els.syncConflictText.textContent = `${pluralFiles(status.conflictCount)} changed both locally and remotely — will be skipped unless you choose to overwrite.`;
    show(els.syncConflictWarning);
    syncRequiresConflictAck = true;
  } else {
    hide(els.syncConflictWarning);
    syncRequiresConflictAck = false;
  }

  if (status.modifiedCount > 0) {
    renderSyncPathList(els.syncModifiedList, status.modified || []);
    show(els.syncModifiedWarning);
    syncRequiresModifiedAck = true;
  } else {
    hide(els.syncModifiedWarning);
    els.syncModifiedList.replaceChildren();
    syncRequiresModifiedAck = false;
  }

  updateSyncStartEnabled();
}

function buildSyncBadges(status) {
  const badges = new Map();
  for (const p of (status.localNew || [])) {
    badges.set(p, 'new');
    injectLocalFile(p);
  }
  for (const p of (status.modified || [])) {
    badges.set(p, 'modified');
  }
  for (const p of (status.outdated || [])) {
    badges.set(p, 'outdated');
  }
  for (const p of (status.conflicts || [])) {
    badges.set(p, 'conflict');
  }
  for (const p of (status.unchanged || [])) {
    badges.set(p, 'synced');
  }
  for (const p of (status.deletedLocally || [])) {
    badges.set(p, 'deleted');
  }
  for (const p of (status.syncedFolders || [])) {
    badges.set(p, 'synced');
  }
  state.tree.syncBadges = badges;
  paintFileTree();
}

function injectLocalFile(daPath) {
  const lastSlash = daPath.lastIndexOf('/');
  const parentPath = lastSlash > 0 ? daPath.slice(0, lastSlash) : '/';
  const fileName = daPath.slice(lastSlash + 1);
  const dotIdx = fileName.lastIndexOf('.');
  const name = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1) : undefined;

  const folder = state.tree.cache[parentPath];
  if (!folder) {
    return;
  }
  if (folder.some((item) => item.daPath === daPath)) {
    return;
  }
  folder.push({
    name, ext, daPath, isFolder: false,
  });
}

function injectLocalFilesForFolder(folderPath) {
  for (const [p, badge] of state.tree.syncBadges) {
    if (badge !== 'new') {
      continue; // eslint-disable-line no-continue
    }
    const lastSlash = p.lastIndexOf('/');
    const parent = lastSlash > 0 ? p.slice(0, lastSlash) : '/';
    if (parent === folderPath) {
      injectLocalFile(p);
    }
  }
}

async function runSyncCheck() {
  if (!syncFolder || !state.activeSiteId) {
    syncTotalFiles = 0;
    syncRequiresModifiedAck = false;
    syncRequiresConflictAck = false;
    updateSyncStartEnabled();
    hide(els.syncStatus);
    hide(els.syncModifiedWarning);
    hide(els.syncConflictWarning);
    return;
  }

  els.syncSelectionSummary.textContent = 'Checking…';
  els.syncStart.disabled = true;

  try {
    const items = getSelectedItems();
    const status = await window.aemDesktop.checkSync({
      siteId: state.activeSiteId,
      items,
      destFolder: syncFolder,
      includeBinaries: els.syncIncludeBinaries.checked,
    });

    syncConflicts = status.conflicts || [];
    syncUnchanged = status.unchanged || [];
    syncModified = status.modified || [];
    syncTotalFiles = status.totalFiles;
    els.syncOverwriteModified.checked = false;
    els.syncOverwriteConflicts.checked = false;
    els.syncSelectionSummary.textContent = `${pluralFiles(status.totalFiles)} to sync`;
    renderSyncStatus(status);
    updateSyncStartEnabled();
  } catch (err) {
    syncTotalFiles = 0;
    syncRequiresModifiedAck = false;
    syncRequiresConflictAck = false;
    els.syncSelectionSummary.textContent = err.message || 'Check failed';
    hide(els.syncStatus);
    hide(els.syncDeletedLocally);
    hide(els.syncLocalOnly);
    hide(els.syncModifiedWarning);
    hide(els.syncConflictWarning);
    updateSyncStartEnabled();
  }
}

function openSyncModal() {
  const count = state.tree.selectedPaths.size;
  if (count === 0) {
    return;
  }
  resetSyncModalState();
  renderSyncSelectionList();
  els.syncSelectionSummary.textContent = '';
  updateSyncFolderDisplay();
  show(els.syncModal);

  if (syncFolder) {
    runSyncCheck();
  } else {
    syncTotalFiles = 0;
    updateSyncStartEnabled();
  }
}

function closeSyncModal() {
  if (syncing) {
    window.aemDesktop.cancelSync();
  }
  if (removeSyncProgressListener) {
    removeSyncProgressListener();
    removeSyncProgressListener = null;
  }
  syncing = false;
  hide(els.syncModal);
  if (syncFolder && state.activeSiteId) {
    autoSyncCheck();
  }
}

async function pickSyncFolder() {
  const folder = await window.aemDesktop.pickSyncFolder();
  if (folder) {
    syncFolder = folder;
    localStorage.setItem('syncFolder', folder);
    updateSyncFolderDisplay();
    runSyncCheck();
  }
}

function handleSyncProgress(data) {
  if (data.phase === 'listing') {
    els.syncProgressText.textContent = 'Listing files…';
    els.syncProgressFill.style.width = '0%';
  } else if (data.phase === 'downloading') {
    const pct = data.total > 0
      ? Math.round((data.completed / data.total) * 100) : 0;
    els.syncProgressFill.style.width = `${pct}%`;
    const current = data.current ? displayPath(data.current) : '';
    els.syncProgressText.textContent = `${data.completed} / ${data.total}  ${current}`;
  } else if (data.phase === 'done') {
    els.syncProgressFill.style.width = '100%';
    els.syncProgressText.textContent = `Done — ${pluralFiles(data.total)} synced`;
    syncing = false;
    els.syncStart.disabled = true;
    els.syncCancel.textContent = 'Close';
    if (syncedPath) {
      show(els.syncReveal);
    }
  }
}

async function startSync() {
  if (!syncFolder || !state.activeSiteId) {
    return;
  }

  syncing = true;
  els.syncStart.disabled = true;
  els.syncPickFolder.disabled = true;
  hide(els.syncStatus);
  hide(els.syncLocalNew);
  hide(els.syncDeletedLocally);
  hide(els.syncLocalOnly);
  hide(els.syncModifiedWarning);
  hide(els.syncConflictWarning);
  show(els.syncProgress);
  els.syncProgressText.textContent = 'Starting…';

  removeSyncProgressListener = window.aemDesktop.onSyncProgress(handleSyncProgress);

  const overwriteConflicts = els.syncOverwriteConflicts.checked;
  const overwriteModified = els.syncOverwriteModified.checked;
  const skips = [
    ...syncUnchanged,
    ...(!overwriteModified ? syncModified : []),
    ...(!overwriteConflicts ? syncConflicts : []),
  ];
  const skipConflicts = skips.length > 0 ? skips : undefined;

  try {
    const items = getSelectedItems();
    const result = await window.aemDesktop.runSync({
      siteId: state.activeSiteId,
      items,
      destFolder: syncFolder,
      includeBinaries: els.syncIncludeBinaries.checked,
      skipConflicts,
    });

    if (result.cancelled) {
      els.syncProgressText.textContent = 'Cancelled';
      els.syncProgressFill.style.width = '0%';
      autoSyncCheck();
    } else {
      if (result.syncedPath) {
        syncedPath = result.syncedPath;
      }
      autoSyncCheck();
    }
  } catch (err) {
    els.syncProgressText.textContent = err.message || 'Sync failed';
  } finally {
    syncing = false;
    els.syncPickFolder.disabled = false;
    els.syncCancel.textContent = 'Close';
    if (removeSyncProgressListener) {
      removeSyncProgressListener();
      removeSyncProgressListener = null;
    }
  }
}

let pushing = false;
let reviewDiffs = [];
/** @type {Set<string>} */
let reviewSelectedPaths = new Set();
let reviewAnchorPath = null;
let reviewFocusPath = null;
/** @type {Set<string>} */
let reviewCheckedPaths = new Set();
let removePushProgressListener = null;

function reviewVisiblePaths() {
  return reviewDiffs.map((d) => d.daPath);
}

function paintReviewFileList() {
  renderReviewFileList(
    els.reviewFileContainer,
    reviewDiffs,
    reviewSelectedPaths,
    reviewFocusPath,
    reviewCheckedPaths,
    handleReviewRowClick,
    toggleReviewCheck,
  );
}

function showReviewDiff(daPath) {
  const file = reviewDiffs.find((d) => d.daPath === daPath);
  if (file) {
    renderDiffView(els.reviewDiffBody, file);
  }
}

function focusReviewFile(daPath) {
  reviewSelectedPaths = new Set([daPath]);
  reviewAnchorPath = daPath;
  reviewFocusPath = daPath;
  paintReviewFileList();
  showReviewDiff(daPath);
}

function handleReviewRowClick(daPath, { metaKey, shiftKey }) {
  const { selectedPaths, anchorPath } = applyFinderClick({
    visiblePaths: reviewVisiblePaths(),
    selectedPaths: reviewSelectedPaths,
    anchorPath: reviewAnchorPath,
    daPath,
    metaKey,
    shiftKey,
  });
  reviewSelectedPaths = selectedPaths;
  reviewAnchorPath = anchorPath;
  reviewFocusPath = daPath;
  paintReviewFileList();
  if (reviewSelectedPaths.size === 1) {
    showReviewDiff(daPath);
  }
}

function selectAllReviewFiles() {
  reviewSelectedPaths = selectAllPaths(reviewVisiblePaths());
  if (reviewSelectedPaths.size > 0) {
    reviewFocusPath = reviewFocusPath || reviewDiffs[0].daPath;
    reviewAnchorPath = reviewFocusPath;
  }
  paintReviewFileList();
}

function toggleReviewCheckSelection() {
  let targets = [];
  if (reviewSelectedPaths.size > 0) {
    targets = [...reviewSelectedPaths];
  } else if (reviewFocusPath) {
    targets = [reviewFocusPath];
  }
  if (targets.length === 0) {
    return;
  }
  reviewCheckedPaths = togglePathsCheckState(reviewCheckedPaths, targets);
  paintReviewFileList();
  updateReviewPushButton();
}

function toggleReviewCheck(daPath, checked) {
  if (checked) {
    reviewCheckedPaths.add(daPath);
  } else {
    reviewCheckedPaths.delete(daPath);
  }
  paintReviewFileList();
  updateReviewPushButton();
}

function checkedReviewDiffs() {
  return reviewDiffs.filter((d) => reviewCheckedPaths.has(d.daPath));
}

function updateReviewPushButton({ forceDisabled = false } = {}) {
  const count = checkedReviewDiffs().length;
  els.reviewPush.disabled = forceDisabled || pushing || count === 0;
  els.reviewPush.textContent = count > 0 && !forceDisabled
    ? `Push changes (${count})`
    : 'Push changes';
}

function renderReviewPlaceholder(message) {
  els.reviewDiffBody.replaceChildren();
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = message;
  els.reviewDiffBody.append(p);
}

async function loadReviewChanges() {
  const pushStatus = await window.aemDesktop.checkPush({
    siteId: state.activeSiteId,
    destFolder: syncFolder,
  });

  const total = pushStatus.modified.length
    + pushStatus.localNew.length
    + pushStatus.deleted.length;

  state.tree.hasPushChanges = total > 0;

  if (total === 0) {
    return { empty: true, diffs: [] };
  }

  const diffs = await window.aemDesktop.getPushDiffs({
    siteId: state.activeSiteId,
    destFolder: syncFolder,
    modified: pushStatus.modified,
    localNew: pushStatus.localNew,
    deleted: pushStatus.deleted,
  });

  return { empty: false, diffs };
}

function applyReviewDiffs(diffs, { preserveSelection = false } = {}) {
  reviewDiffs = diffs;
  const paths = new Set(reviewDiffs.map((d) => d.daPath));

  if (preserveSelection) {
    reviewCheckedPaths = new Set(
      [...reviewCheckedPaths].filter((p) => paths.has(p)),
    );
    reviewSelectedPaths = new Set(
      [...reviewSelectedPaths].filter((p) => paths.has(p)),
    );
    if (reviewSelectedPaths.size === 0 && reviewDiffs.length > 0) {
      reviewSelectedPaths = new Set([reviewDiffs[0].daPath]);
    }
    const nextFocus = paths.has(reviewFocusPath)
      ? reviewFocusPath
      : (reviewDiffs[0]?.daPath ?? null);
    reviewFocusPath = nextFocus;
    reviewAnchorPath = nextFocus;
  } else {
    reviewCheckedPaths = new Set(reviewDiffs.map((d) => d.daPath));
    const first = reviewDiffs[0]?.daPath ?? null;
    reviewSelectedPaths = first ? new Set([first]) : new Set();
    reviewFocusPath = first;
    reviewAnchorPath = first;
  }

  updateReviewPushButton();
  paintReviewFileList();
  if (reviewFocusPath) {
    showReviewDiff(reviewFocusPath);
  } else {
    renderReviewPlaceholder('Select a file to see changes.');
  }
}

function resetReviewProgressUi() {
  hide(els.reviewProgress);
  els.reviewProgressFill.style.width = '0%';
  els.reviewProgressText.textContent = '';
  els.reviewCancel.textContent = 'Cancel';
  pushing = false;
}

async function refreshReviewChanges() {
  if (!syncFolder || !state.activeSiteId) {
    return;
  }

  try {
    const { empty, diffs } = await loadReviewChanges();
    paintFileTree();

    if (empty) {
      pushing = false;
      closeReviewView();
      return;
    }

    resetReviewProgressUi();
    applyReviewDiffs(diffs, { preserveSelection: true });
    autoSyncCheck();
  } catch (err) {
    renderReviewPlaceholder(err.message || 'Failed to reload changes');
    resetReviewProgressUi();
    updateReviewPushButton();
  }
}

async function openPushModal() {
  if (!syncFolder || !state.activeSiteId) {
    return;
  }

  pushing = false;
  reviewDiffs = [];
  reviewSelectedPaths = new Set();
  reviewAnchorPath = null;
  reviewFocusPath = null;
  reviewCheckedPaths = new Set();
  els.reviewPush.disabled = true;
  els.reviewPush.textContent = 'Push changes';
  els.reviewCancel.textContent = 'Cancel';
  hide(els.reviewProgress);
  els.reviewProgressFill.style.width = '0%';
  els.reviewProgressText.textContent = '';
  renderReviewPlaceholder('Loading changes…');
  renderReviewFileList(
    els.reviewFileContainer,
    [],
    reviewSelectedPaths,
    null,
    reviewCheckedPaths,
    () => {},
    () => {},
  );

  showView('review');

  try {
    const { empty, diffs } = await loadReviewChanges();

    if (empty) {
      renderReviewFileList(
        els.reviewFileContainer,
        [],
        reviewSelectedPaths,
        null,
        reviewCheckedPaths,
        () => {},
        () => {},
      );
      renderReviewPlaceholder('No local changes to push');
      return;
    }

    applyReviewDiffs(diffs);
  } catch (err) {
    renderReviewPlaceholder(err.message || 'Failed to load changes');
  }
}

function closeReviewView() {
  if (pushing) {
    window.aemDesktop.cancelPush();
  }
  if (removePushProgressListener) {
    removePushProgressListener();
    removePushProgressListener = null;
  }
  pushing = false;
  reviewDiffs = [];
  reviewSelectedPaths = new Set();
  reviewAnchorPath = null;
  reviewFocusPath = null;
  reviewCheckedPaths = new Set();
  showView('browse');
  autoSyncCheck();
}

function handlePushProgress(data) {
  if (data.phase === 'uploading') {
    const pct = data.total > 0
      ? Math.round((data.completed / data.total) * 100) : 0;
    els.reviewProgressFill.style.width = `${pct}%`;
    const current = data.current ? displayPath(data.current) : '';
    els.reviewProgressText.textContent = `Uploading ${data.completed} / ${data.total}  ${current}`;
  } else if (data.phase === 'deleting') {
    const pct = data.total > 0
      ? Math.round((data.completed / data.total) * 100) : 0;
    els.reviewProgressFill.style.width = `${pct}%`;
    const current = data.current ? displayPath(data.current) : '';
    els.reviewProgressText.textContent = `Deleting ${data.completed} / ${data.total}  ${current}`;
  } else if (data.phase === 'done') {
    els.reviewProgressFill.style.width = '100%';
    els.reviewProgressText.textContent = `Done — ${pluralFiles(data.total)} pushed`;
    pushing = false;
    updateReviewPushButton({ forceDisabled: true });
    els.reviewCancel.textContent = 'Done';
  }
}

async function startPush() {
  const selectedDiffs = checkedReviewDiffs();
  if (!syncFolder || !state.activeSiteId || selectedDiffs.length === 0) {
    return;
  }

  pushing = true;
  updateReviewPushButton();
  show(els.reviewProgress);
  els.reviewProgressText.textContent = `Starting — ${pluralFiles(selectedDiffs.length)}…`;

  removePushProgressListener = window.aemDesktop.onPushProgress(handlePushProgress);

  const filesToPush = selectedDiffs
    .filter((d) => d.status !== 'deleted')
    .map((d) => d.daPath);
  const filesToDelete = selectedDiffs
    .filter((d) => d.status === 'deleted')
    .map((d) => d.daPath);

  try {
    const result = await window.aemDesktop.runPush({
      siteId: state.activeSiteId,
      destFolder: syncFolder,
      filesToPush,
      filesToDelete,
    });

    if (result.cancelled) {
      els.reviewProgressText.textContent = 'Cancelled';
      els.reviewProgressFill.style.width = '0%';
    } else {
      await refreshReviewChanges();
    }
  } catch (err) {
    els.reviewProgressText.textContent = err.message || 'Push failed';
  } finally {
    pushing = false;
    if (removePushProgressListener) {
      removePushProgressListener();
      removePushProgressListener = null;
    }
    if (els.reviewCancel.textContent !== 'Done') {
      updateReviewPushButton();
    }
  }
}

function wireUi() {
  els.navHome.addEventListener('click', goHome);

  els.addSiteToggle.addEventListener('click', () => {
    show(els.addSiteForm);
    els.siteUrlInput.focus();
  });

  els.addSiteCancel.addEventListener('click', () => {
    hide(els.addSiteForm);
    setError('');
    els.siteUrlInput.value = '';
  });

  els.addSiteForm.addEventListener('submit', handleAddSite);
  els.signInBtn.addEventListener('click', handleSignIn);
  els.signOutBtn.addEventListener('click', handleSignOut);

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'r') {
      event.preventDefault();
      if (state.view === 'browse') {
        hardRefresh();
      }
    }
  });

  els.fileTree.addEventListener('keydown', (event) => {
    const tree = els.fileTree.querySelector('[role="tree"]');
    if (!tree) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
      event.preventDefault();
      selectAllVisibleItems();
      return;
    }

    treeKeydown(event, tree, {
      onActivate: (el) => {
        const { daPath } = el.dataset;
        if (el.dataset.folder === 'true') {
          toggleFolder(daPath);
          return;
        }
        const item = findItemInCache(daPath);
        if (item) {
          previewFile(item);
        }
      },
      onExpand: (el) => expandFolder(el.dataset.daPath),
      onCollapse: (el) => collapseFolder(el.dataset.daPath),
      onFocusMove: (el, keyEvent) => {
        const { daPath } = el.dataset;
        const paths = visiblePaths();
        const { selectedPaths, anchorPath } = applyFinderClick({
          visiblePaths: paths,
          selectedPaths: state.tree.selectedPaths,
          anchorPath: state.tree.anchorPath,
          daPath,
          metaKey: false,
          shiftKey: keyEvent.shiftKey,
        });
        state.tree.selectedPaths = selectedPaths;
        state.tree.anchorPath = anchorPath;
        paintFileTree();

        if (!keyEvent.shiftKey && selectedPaths.size === 1) {
          const item = findItemInCache(daPath);
          if (item && !item.isFolder) {
            previewFile(item);
          }
        }
      },
    });
  });

  els.fileTree.addEventListener('focusin', (event) => {
    const tree = els.fileTree.querySelector('[role="tree"]');
    if (tree) {
      treeFocusIn(event, tree);
    }
  });

  els.syncPickFolder.addEventListener('click', pickSyncFolder);
  els.syncStart.addEventListener('click', startSync);
  els.syncCancel.addEventListener('click', closeSyncModal);
  els.syncIncludeBinaries.addEventListener('change', () => {
    if (syncFolder && !syncing) {
      runSyncCheck();
    }
  });
  els.syncOverwriteModified.addEventListener('change', updateSyncStartEnabled);
  els.syncOverwriteConflicts.addEventListener('change', updateSyncStartEnabled);
  els.syncReveal.addEventListener('click', () => {
    if (syncedPath) {
      window.aemDesktop.revealSync(syncedPath);
    }
  });

  els.syncModal.addEventListener('click', (event) => {
    if (event.target === els.syncModal) {
      closeSyncModal();
    }
  });

  els.reviewPush.addEventListener('click', startPush);
  els.reviewCancel.addEventListener('click', closeReviewView);
  wireReviewKeyboard(els.reviewFileContainer, {
    onSelect: focusReviewFile,
    onSelectAll: selectAllReviewFiles,
    onToggleCheckSelection: toggleReviewCheckSelection,
  });

  window.addEventListener('dblclick', () => {
    window.aemDesktop.captureScreenshot();
  });
}

async function init() {
  wireUi();
  state.icons = await loadIcons();
  await refreshAuthStatus();
  await loadSites();
  showView('home');
}

init();
