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
import { renderDocumentView, renderDocumentDiffView } from './document-view.js';

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
    hasPullChanges: false,
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
  useApiAemLive: document.getElementById('use-api-aem-live'),
  addSiteError: document.getElementById('add-site-error'),
  fileTree: document.getElementById('file-tree'),
  authStatus: document.getElementById('auth-status'),
  signInBtn: document.getElementById('sign-in-btn'),
  signOutBtn: document.getElementById('sign-out-btn'),
  contentToolbar: document.getElementById('content-toolbar'),
  contentSegment: document.getElementById('content-segment'),
  contentSegmentPreview: document.getElementById('content-segment-preview'),
  contentSegmentCode: document.getElementById('content-segment-code'),
  contentSegmentDocument: document.getElementById('content-segment-document'),
  contentPreviewPane: document.getElementById('content-preview-pane'),
  contentCodePane: document.getElementById('content-code-pane'),
  contentDocumentPane: document.getElementById('content-document-pane'),
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
  pullModal: document.getElementById('pull-modal'),
  pullSummary: document.getElementById('pull-summary'),
  pullFolderPath: document.getElementById('pull-folder-path'),
  pullIncludeBinaries: document.getElementById('pull-include-binaries'),
  pullEmptyNotice: document.getElementById('pull-empty-notice'),
  pullFileSection: document.getElementById('pull-file-section'),
  pullFileList: document.getElementById('pull-file-list'),
  pullConflictWarning: document.getElementById('pull-conflict-warning'),
  pullConflictText: document.getElementById('pull-conflict-text'),
  pullConflictList: document.getElementById('pull-conflict-list'),
  pullOverwriteConflicts: document.getElementById('pull-overwrite-conflicts'),
  pullStart: document.getElementById('pull-start'),
  pullCancel: document.getElementById('pull-cancel'),
  pullProgress: document.getElementById('pull-progress'),
  pullProgressFill: document.getElementById('pull-progress-fill'),
  pullProgressText: document.getElementById('pull-progress-text'),
  reviewView: document.getElementById('review-view'),
  reviewFileContainer: document.getElementById('review-file-container'),
  reviewContentToolbar: document.getElementById('review-content-toolbar'),
  reviewSegment: document.getElementById('review-segment'),
  reviewSegmentPreview: document.getElementById('review-segment-preview'),
  reviewSegmentCode: document.getElementById('review-segment-code'),
  reviewSegmentDocument: document.getElementById('review-segment-document'),
  reviewPreviewPane: document.getElementById('review-preview-pane'),
  reviewCodePane: document.getElementById('review-code-pane'),
  reviewDocumentPane: document.getElementById('review-document-pane'),
  reviewCancel: document.getElementById('review-cancel'),
  reviewRevert: document.getElementById('review-revert'),
  reviewPush: document.getElementById('review-push'),
  reviewProgress: document.getElementById('review-progress'),
  reviewProgressFill: document.getElementById('review-progress-fill'),
  reviewProgressText: document.getElementById('review-progress-text'),
  reviewPostPushActions: document.getElementById('review-post-push-actions'),
  reviewCopyPreviewUrls: document.getElementById('review-copy-preview-urls'),
  reviewPreviewPublish: document.getElementById('review-preview-publish'),
  helix6Modal: document.getElementById('helix6-modal'),
  helix6PathList: document.getElementById('helix6-path-list'),
  helix6Progress: document.getElementById('helix6-progress'),
  helix6ProgressFill: document.getElementById('helix6-progress-fill'),
  helix6ProgressText: document.getElementById('helix6-progress-text'),
  helix6Error: document.getElementById('helix6-error'),
  helix6Start: document.getElementById('helix6-start'),
  helix6Cancel: document.getElementById('helix6-cancel'),
};

function activeSite() {
  return state.sites.find((site) => site.id === state.activeSiteId) ?? null;
}

function isHelix6Site() {
  return activeSite()?.apiBackend === 'api.aem.live';
}

function showReviewPostPushActions() {
  if (lastPushedDaPaths.length === 0) {
    hide(els.reviewPostPushActions);
    return;
  }
  show(els.reviewPostPushActions);
  if (isHelix6Site()) {
    show(els.reviewPreviewPublish);
  } else {
    hide(els.reviewPreviewPublish);
  }
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
  await window.aemDesktop.setActivePreviewSite(siteId);
  resetTree();
  resetBrowseContentView();
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

/**
 * @param {string} title
 * @param {{ message?: string, xError?: string|null, detail?: string }|Error|string} error
 */
async function showRequestErrorDialog(title, error) {
  const payload = typeof error === 'string'
    ? { message: error }
    : error;
  const message = payload?.message || String(error);
  await window.aemDesktop.showErrorDialog({
    title,
    message,
    detail: payload?.detail || message,
    xError: payload?.xError ?? null,
  });
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
  const backend = site.apiBackend && site.apiBackend !== 'da.live' ? site.apiBackend : null;
  return backend ? `${site.org}/${site.repo} (${backend})` : `${site.org}/${site.repo}`;
}

function selectedApiBackend() {
  return els.useApiAemLive.checked ? 'api.aem.live' : 'da.live';
}

function resetAddSiteForm() {
  els.siteUrlInput.value = '';
  els.useApiAemLive.checked = false;
  setError('');
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
    hasPushChanges: false,
    hasPullChanges: false,
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
    els.authStatus.textContent = 'Signed in to AEM';
    els.authStatus.classList.add('ok');
    hide(els.signInBtn);
    show(els.signOutBtn);
    els.addSiteToggle.disabled = false;
  } else {
    els.authStatus.textContent = 'Sign in to AEM to open a site';
    els.authStatus.classList.remove('ok');
    show(els.signInBtn);
    hide(els.signOutBtn);
    els.addSiteToggle.disabled = true;
    hide(els.addSiteForm);
    resetAddSiteForm();
  }
  renderSites();
}

/** @typedef {'preview' | 'code' | 'document'} ContentMode */

const CONTENT_MODES = ['document', 'preview', 'code'];
const CONTENT_MODE_STORAGE_KEY = 'contentViewMode';

/**
 * @returns {ContentMode}
 */
function loadStoredContentMode() {
  try {
    const stored = localStorage.getItem(CONTENT_MODE_STORAGE_KEY);
    if (stored && CONTENT_MODES.includes(stored)) {
      return stored;
    }
  } catch {
    /* localStorage unavailable */
  }
  return 'document';
}

/**
 * @param {ContentMode} mode
 */
function saveContentMode(mode) {
  try {
    localStorage.setItem(CONTENT_MODE_STORAGE_KEY, mode);
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * @param {ContentMode} mode
 * @param {{ codeEnabled?: boolean }} [options]
 * @returns {ContentMode}
 */
function resolveContentMode(mode, { codeEnabled = true } = {}) {
  if (mode === 'code' && !codeEnabled) {
    const stored = loadStoredContentMode();
    return stored === 'code' ? 'document' : stored;
  }
  return mode;
}

let previewDevEnabled = null;

/** @type {ContentMode} */
let browseContentMode = loadStoredContentMode();
/** @type {{ daPath: string, isFolder: boolean }|null} */
let browseOpenedItem = null;
let browseCodeAvailable = false;

/** @type {ContentMode} */
let reviewContentMode = loadStoredContentMode();

async function previewDevMode() {
  if (previewDevEnabled === null) {
    previewDevEnabled = await window.aemDesktop.isDev();
  }
  return previewDevEnabled;
}

function setPanePlaceholder(pane, message) {
  pane.classList.remove('is-preview');
  pane.replaceChildren();
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = message;
  pane.append(p);
}

/**
 * @param {HTMLElement} segmentEl
 * @param {HTMLButtonElement[]} buttons
 * @param {ContentMode} mode
 * @param {{ codeEnabled?: boolean }} [options]
 * @returns {ContentMode}
 */
function setSegmentMode(segmentEl, buttons, mode, { codeEnabled = true } = {}) {
  const activeMode = resolveContentMode(mode, { codeEnabled });

  // DOM state update on the passed segment container.
  // eslint-disable-next-line no-param-reassign -- dataset drives the sliding thumb position
  segmentEl.dataset.active = activeMode;

  buttons.forEach((btn, index) => {
    const btnMode = CONTENT_MODES[index];
    const isActive = btnMode === activeMode;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  const codeBtn = buttons[CONTENT_MODES.indexOf('code')];
  if (codeBtn) {
    if (codeEnabled) {
      codeBtn.removeAttribute('disabled');
    } else {
      codeBtn.setAttribute('disabled', '');
    }
  }

  return activeMode;
}

/**
 * @param {{ preview: HTMLElement, code: HTMLElement, document: HTMLElement }} panes
 * @param {ContentMode} mode
 */
function setPaneActive(panes, mode) {
  panes.preview.classList.toggle('is-active', mode === 'preview');
  panes.preview.classList.toggle('is-preview', mode === 'preview');
  panes.code.classList.toggle('is-active', mode === 'code');
  panes.document.classList.toggle('is-active', mode === 'document');
}

const browsePanes = () => ({
  preview: els.contentPreviewPane,
  code: els.contentCodePane,
  document: els.contentDocumentPane,
});

const reviewPanes = () => ({
  preview: els.reviewPreviewPane,
  code: els.reviewCodePane,
  document: els.reviewDocumentPane,
});

const browseSegmentButtons = () => [
  els.contentSegmentDocument,
  els.contentSegmentPreview,
  els.contentSegmentCode,
];

const reviewSegmentButtons = () => [
  els.reviewSegmentDocument,
  els.reviewSegmentPreview,
  els.reviewSegmentCode,
];

/**
 * @param {HTMLElement} pane
 * @returns {{
 *   show: (opts: { url: string, previewOrigin: string }) => void,
 *   reload: () => void,
 *   openDevTools: () => void,
 *   destroy: () => void,
 *   getWebview: () => (HTMLElement | null),
 *   getLastPreview: () => ({ url: string, previewOrigin: string } | null),
 *   renderPlaceholder: (message: string) => void,
 *   renderSignIn: (onLogin: (button: HTMLButtonElement) => void) => void,
 * }}
 */
function createPreviewController(pane) {
  let webview = null;
  let previewOrigin = null;
  let devToolsAutoOpened = false;
  /** @type {{ url: string, previewOrigin: string }|null} */
  let lastPreview = null;

  function destroy() {
    if (webview) {
      webview.remove();
      webview = null;
      previewOrigin = null;
      devToolsAutoOpened = false;
    }
  }

  function isAllowedPreviewNavigation(url) {
    if (!previewOrigin) {
      return false;
    }
    try {
      const target = new URL(url);
      return target.origin === new URL(previewOrigin).origin;
    } catch {
      return false;
    }
  }

  function wirePreviewWebviewDevTools(wv) {
    wv.addEventListener('dom-ready', () => {
      previewDevMode().then((dev) => {
        if (!dev || wv !== webview || devToolsAutoOpened) {
          return;
        }
        wv.openDevTools({ mode: 'right' });
        devToolsAutoOpened = true;
      });
    });

    wv.addEventListener('did-fail-load', (event) => {
      if (event.isMainFrame) {
        console.error(
          `[preview] main frame failed: ${event.errorDescription} (${event.errorCode}) ${event.validatedURL}`,
        );
      } else {
        console.warn(
          `[preview] subresource failed: ${event.errorDescription} (${event.errorCode}) ${event.validatedURL}`,
        );
      }
    });

    wv.addEventListener('console-message', (event) => {
      const line = `[preview:${event.level}] ${event.message}`;
      if (event.level >= 3) {
        console.error(line);
      } else if (event.level === 2) {
        console.warn(line);
      } else {
        console.info(line);
      }
    });
  }

  function ensureWebview(origin) {
    if (webview && previewOrigin === origin) {
      return webview;
    }

    destroy();
    pane.replaceChildren();
    pane.classList.add('is-preview');

    const wv = document.createElement('webview');
    wv.className = 'preview-webview';
    wv.setAttribute('allowpopups', 'false');

    wv.addEventListener('will-navigate', (event) => {
      if (!isAllowedPreviewNavigation(event.url)) {
        event.preventDefault();
        window.aemDesktop.openExternal(event.url);
      }
    });

    wv.addEventListener('new-window', (event) => {
      event.preventDefault();
      window.aemDesktop.openExternal(event.url);
    });

    wv.addEventListener('did-start-loading', () => {
      previewDevMode().then((dev) => {
        if (dev) {
          console.info(`[preview] loading ${wv.getURL()}`);
        }
      });
    });

    pane.append(wv);
    webview = wv;
    previewOrigin = origin;

    previewDevMode().then((dev) => {
      if (dev && wv === webview) {
        wirePreviewWebviewDevTools(wv);
      }
    });

    wv.addEventListener('did-finish-load', () => {
      previewDevMode().then((dev) => {
        if (dev) {
          console.info(`[preview] loaded ${wv.getURL()}`);
        }
      });
      checkPreviewAuthError(wv);
    });

    return wv;
  }

  return {
    show({ url, previewOrigin: origin }) {
      lastPreview = { url, previewOrigin: origin };
      pane.classList.add('is-preview');
      const wv = ensureWebview(origin);
      wv.src = url;
    },
    reload() {
      webview?.reloadIgnoringCache();
    },
    openDevTools() {
      if (webview) {
        webview.openDevTools({ mode: 'right' });
        devToolsAutoOpened = true;
      }
    },
    destroy,
    getWebview: () => webview,
    getLastPreview: () => lastPreview,
    renderPlaceholder(message) {
      pane.classList.remove('is-preview');
      destroy();
      setPanePlaceholder(pane, message);
    },
    renderSignIn(onLogin) {
      pane.classList.remove('is-preview');
      destroy();
      pane.replaceChildren();

      const wrap = document.createElement('div');
      wrap.className = 'placeholder preview-signin';

      const message = document.createElement('p');
      message.textContent = 'This site requires sign-in to preview protected content.';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn primary';
      button.textContent = 'Sign in to preview';
      button.addEventListener('click', () => onLogin(button));

      wrap.append(message, button);
      pane.append(wrap);
    },
  };
}

const browsePreview = createPreviewController(els.contentPreviewPane);
const reviewPreview = createPreviewController(els.reviewPreviewPane);

let previewAuthPrompted = false;

function resetBrowseContentView() {
  browseContentMode = loadStoredContentMode();
  browseOpenedItem = null;
  browseCodeAvailable = false;
  browsePreview.destroy();
  hide(els.contentToolbar);
  browseContentMode = setSegmentMode(
    els.contentSegment,
    browseSegmentButtons(),
    browseContentMode,
    { codeEnabled: false },
  );
  setPaneActive(browsePanes(), browseContentMode);
  const placeholder = 'Select a file from the folder list.';
  els.contentPreviewPane.replaceChildren();
  els.contentCodePane.replaceChildren();
  els.contentDocumentPane.replaceChildren();
  if (browseContentMode === 'preview') {
    setPanePlaceholder(els.contentPreviewPane, placeholder);
  } else if (browseContentMode === 'document') {
    setPanePlaceholder(els.contentDocumentPane, placeholder);
  } else {
    setPanePlaceholder(els.contentCodePane, placeholder);
  }
}

function syncBrowseContentView() {
  if (browseOpenedItem) {
    show(els.contentToolbar);
  } else {
    hide(els.contentToolbar);
  }

  browseContentMode = setSegmentMode(
    els.contentSegment,
    browseSegmentButtons(),
    browseContentMode,
    { codeEnabled: browseCodeAvailable },
  );
  setPaneActive(browsePanes(), browseContentMode);
}

function setBrowseContentMode(mode) {
  if (mode === 'code' && !browseCodeAvailable) {
    return;
  }
  browseContentMode = mode;
  saveContentMode(mode);
  syncBrowseContentView();
  if (!browseOpenedItem) {
    return;
  }
  if (mode === 'code') {
    loadBrowseCode(browseOpenedItem);
  } else if (mode === 'document') {
    loadBrowseDocument(browseOpenedItem);
  }
}

function updateBrowseCodeAvailability() {
  browseCodeAvailable = Boolean(syncFolder);
  browseContentMode = resolveContentMode(browseContentMode, { codeEnabled: browseCodeAvailable });
  syncBrowseContentView();
}

async function loadFileDiff(daPath) {
  if (!syncFolder || !state.activeSiteId) {
    return null;
  }

  const pushStatus = await window.aemDesktop.checkPush({
    siteId: state.activeSiteId,
    destFolder: syncFolder,
  });

  const modified = pushStatus.modified.includes(daPath) ? [daPath] : [];
  const localNew = pushStatus.localNew.includes(daPath) ? [daPath] : [];
  const deleted = pushStatus.deleted.includes(daPath) ? [daPath] : [];

  if (modified.length + localNew.length + deleted.length === 0) {
    return null;
  }

  const diffs = await window.aemDesktop.getPushDiffs({
    siteId: state.activeSiteId,
    destFolder: syncFolder,
    modified,
    localNew,
    deleted,
  });

  return diffs[0] ?? null;
}

async function loadBrowseCode(item) {
  setPanePlaceholder(els.contentCodePane, 'Loading changes…');
  try {
    const file = await loadFileDiff(item.daPath);
    if (!file) {
      setPanePlaceholder(els.contentCodePane, 'No local changes for this file.');
      return;
    }
    renderDiffView(els.contentCodePane, file);
  } catch (err) {
    setPanePlaceholder(els.contentCodePane, err.message || 'Failed to load changes.');
  }
}

async function loadDocumentViewForPath(daPath, pane) {
  setPanePlaceholder(pane, 'Loading document…');
  try {
    // Local changes render as a track-changes diff against the synced
    // original; otherwise fall back to the plain remote document.
    if (syncFolder) {
      const localDiff = await window.aemDesktop.getDocumentDiff(
        state.activeSiteId,
        syncFolder,
        daPath,
      );
      if (localDiff && localDiff.status !== 'unchanged') {
        renderDocumentDiffView(pane, localDiff.diff);
        return;
      }
    }
    const source = await window.aemDesktop.getDaSource(state.activeSiteId, daPath);
    if (!source) {
      setPanePlaceholder(pane, 'No source content.');
      return;
    }
    if (source.mode !== 'html') {
      setPanePlaceholder(pane, 'Document view is only available for HTML files.');
      return;
    }
    const model = await window.aemDesktop.parseDocumentView(source.text);
    renderDocumentView(pane, model);
  } catch (err) {
    setPanePlaceholder(pane, err.message || 'Failed to load document.');
  }
}

async function loadBrowseDocument(item) {
  await loadDocumentViewForPath(item.daPath, els.contentDocumentPane);
}

function refreshBrowseOpenedFile() {
  if (!browseOpenedItem) {
    return;
  }
  updateBrowseCodeAvailability();
  if (browseContentMode === 'code') {
    loadBrowseCode(browseOpenedItem);
  } else if (browseContentMode === 'document') {
    loadBrowseDocument(browseOpenedItem);
  }
}

function syncReviewContentView() {
  if (reviewFocusPath) {
    show(els.reviewContentToolbar);
  } else {
    hide(els.reviewContentToolbar);
  }

  reviewContentMode = setSegmentMode(
    els.reviewSegment,
    reviewSegmentButtons(),
    reviewContentMode,
  );
  setPaneActive(reviewPanes(), reviewContentMode);
}

function setReviewContentMode(mode) {
  reviewContentMode = mode;
  saveContentMode(mode);
  syncReviewContentView();
  if (!reviewFocusPath) {
    return;
  }
  if (mode === 'preview') {
    loadReviewPreview(reviewFocusPath);
  } else if (mode === 'document') {
    loadReviewDocument(reviewFocusPath);
  }
}

async function loadReviewDocument(daPath) {
  await loadDocumentViewForPath(daPath, els.reviewDocumentPane);
}

async function loadReviewPreview(daPath) {
  if (!state.activeSiteId) {
    return;
  }
  try {
    const preview = await window.aemDesktop.buildPreviewUrl(state.activeSiteId, daPath);
    reviewPreview.show({
      url: preview.url,
      previewOrigin: preview.previewOrigin,
    });
  } catch (err) {
    reviewPreview.renderPlaceholder(err.message || 'Failed to load preview.');
  }
}

function openPreviewDevTools() {
  if (state.view === 'review') {
    reviewPreview.openDevTools();
    return;
  }
  browsePreview.openDevTools();
}

async function doPreviewLogin(button) {
  if (!state.activeSiteId) {
    return;
  }
  const btn = button;
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const result = await window.aemDesktop.loginPreview(state.activeSiteId);
    const lastPreview = browsePreview.getLastPreview();
    if (result?.ok && lastPreview) {
      browsePreview.show(lastPreview);
      return;
    }
    btn.textContent = result?.error ? 'Sign-in failed — try again' : 'Sign in to preview';
  } catch {
    btn.textContent = 'Sign-in failed — try again';
  }
  btn.disabled = false;
}

function handlePreviewAuthRequired({ previewUrl } = {}) {
  if (previewAuthPrompted) {
    return;
  }
  const site = activeSite();
  if (!site || (previewUrl && site.previewUrl !== previewUrl)) {
    return;
  }
  previewAuthPrompted = true;
  browsePreview.renderSignIn(doPreviewLogin);
}

async function detectPreviewAuthStatus(webview) {
  if (!webview || webview !== browsePreview.getWebview()) {
    return null;
  }
  try {
    return await webview.executeJavaScript(`
      (() => {
        const pre = document.querySelector('body > pre');
        if (!pre) return null;
        const text = pre.textContent.trim();
        if (text === '401 Unauthorized') return 401;
        if (text === '403 Forbidden') return 403;
        return null;
      })()
    `, true);
  } catch {
    return null;
  }
}

async function checkPreviewAuthError(webview) {
  const status = await detectPreviewAuthStatus(webview);
  if (status === 401 || status === 403) {
    handlePreviewAuthRequired({ previewUrl: activeSite()?.previewUrl });
  }
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
    onSyncSelected: openSyncModal,
    onPull: openPullModal,
    onPush: openPushModal,
    selectionCount: state.tree.selectedPaths.size,
    syncBadges: state.tree.syncBadges,
    hasPushChanges: state.tree.hasPushChanges,
    hasPullChanges: state.tree.hasPullChanges,
    canPull: Boolean(syncFolder),
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
    await refreshLocalBadgesForFolder(daPath);
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
    await refreshSyncedFolderBadges();
    await loadFolder('/');
    checkPushStatus();
  }
}

async function hardRefresh() {
  if (!state.activeSiteId || !state.authenticated) {
    return;
  }
  const expanded = [...state.tree.expanded];
  state.tree.cache = {};
  state.tree.syncBadges = new Map();

  browsePreview.reload();

  for (const daPath of expanded) {
    await loadFolder(daPath); // eslint-disable-line no-await-in-loop
  }
  autoSyncCheck();
}

async function refreshSyncedFolderBadges() {
  if (!syncFolder || !state.activeSiteId || !state.authenticated) {
    return;
  }
  const siteId = state.activeSiteId;
  try {
    const { badges } = await window.aemDesktop.getLocalSyncBadges({
      siteId,
      destFolder: syncFolder,
    });
    if (state.activeSiteId !== siteId) {
      return;
    }
    mergeSyncBadges(badges);
  } catch {
    // ignore — badges are best-effort in the tree
  }
}

async function refreshLocalBadgesForFolder(daPath) {
  if (!syncFolder || !state.activeSiteId) {
    return;
  }
  const items = state.tree.cache[daPath];
  if (!items) {
    return;
  }
  const siteId = state.activeSiteId;
  try {
    const { badges } = await window.aemDesktop.getLocalSyncBadges({
      siteId,
      destFolder: syncFolder,
      folderPath: daPath,
      items: items.map((item) => ({
        daPath: item.daPath,
        isFolder: item.isFolder,
        lastModified: item.lastModified,
      })),
    });
    if (state.activeSiteId !== siteId) {
      return;
    }
    mergeSyncBadges(badges);
    injectLocalFilesForFolder(daPath);
  } catch {
    // ignore
  }
}

function checkPushStatus() {
  if (!syncFolder || !state.activeSiteId || !state.authenticated) {
    return;
  }
  const siteId = state.activeSiteId;
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

function autoSyncCheck() {
  refreshVisibleLocalBadges();
  checkPushStatus();
}

async function refreshVisibleLocalBadges() {
  await refreshSyncedFolderBadges();
  for (const daPath of state.tree.expanded) {
    if (state.tree.cache[daPath]) {
      // eslint-disable-next-line no-await-in-loop
      await refreshLocalBadgesForFolder(daPath);
    }
  }
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

  browseOpenedItem = item;
  state.tree.openedDaPath = item.daPath;
  updateBrowseCodeAvailability();
  previewAuthPrompted = false;

  try {
    const preview = await window.aemDesktop.buildPreviewUrl(state.activeSiteId, item.daPath);
    browsePreview.show({
      url: preview.url,
      previewOrigin: preview.previewOrigin,
    });
    syncBrowseContentView();
    if (browseContentMode === 'code') {
      await loadBrowseCode(item);
    } else if (browseContentMode === 'document') {
      await loadBrowseDocument(item);
    }
  } catch (err) {
    browseOpenedItem = null;
    browsePreview.renderPlaceholder(err.message || 'Failed to load preview');
    syncBrowseContentView();
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
    btn.title = state.authenticated ? '' : 'Sign in to AEM to open this site';
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
    const site = await window.aemDesktop.addSite(url, selectedApiBackend());
    state.sites = await window.aemDesktop.listSites();
    resetAddSiteForm();
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

let syncFolder = null;
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
  show(els.syncCancel);
  syncing = false;
}

function showSyncCompleteActions() {
  syncing = false;
  els.syncStart.disabled = false;
  els.syncStart.textContent = 'Close';
  hide(els.syncCancel);
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

function mergeSyncBadges(badges) {
  for (const [p, type] of Object.entries(badges)) {
    state.tree.syncBadges.set(p, type);
  }
  updatePullChangesFromBadges();
  paintFileTree();
  refreshBrowseOpenedFile();
}

function updatePullChangesFromBadges() {
  let hasPullChanges = false;
  for (const type of state.tree.syncBadges.values()) {
    if (type === 'outdated' || type === 'conflict') {
      hasPullChanges = true;
      break;
    }
  }
  state.tree.hasPullChanges = hasPullChanges;
}

let pulling = false;
/** @type {string[]} */
let pullOutdated = [];
/** @type {string[]} */
let pullConflicts = [];
/** @type {Array<{ daPath: string, lastModified?: string, ext?: string, conflict: boolean }>} */
let pullFiles = [];
let pullTotalCount = 0;
let removePullProgressListener = null;
let removePullCheckProgressListener = null;

function resetPullModalState() {
  pullOutdated = [];
  pullConflicts = [];
  pullFiles = [];
  pullTotalCount = 0;
  hide(els.pullProgress);
  hide(els.pullEmptyNotice);
  hide(els.pullFileSection);
  hide(els.pullConflictWarning);
  els.pullOverwriteConflicts.checked = false;
  els.pullFileList.replaceChildren();
  els.pullConflictList.replaceChildren();
  els.pullProgressFill.style.width = '0%';
  els.pullProgressText.textContent = '';
  els.pullStart.textContent = 'Pull';
  els.pullCancel.textContent = 'Cancel';
  show(els.pullCancel);
  pulling = false;
}

function updatePullFolderDisplay() {
  if (syncFolder) {
    els.pullFolderPath.textContent = syncFolder;
    els.pullFolderPath.title = syncFolder;
    els.pullFolderPath.classList.remove('no-folder');
  } else {
    els.pullFolderPath.textContent = 'No folder selected';
    els.pullFolderPath.title = '';
    els.pullFolderPath.classList.add('no-folder');
  }
}

function updatePullStartEnabled() {
  if (pulling || !syncFolder || pullTotalCount === 0) {
    els.pullStart.disabled = true;
    return;
  }
  const overwriteConflicts = els.pullOverwriteConflicts.checked;
  const pullableCount = pullFiles.filter((file) => (
    !file.conflict || overwriteConflicts
  )).length;
  els.pullStart.disabled = pullableCount === 0;
}

function renderPullStatus(status) {
  pullOutdated = status.outdated || [];
  pullConflicts = status.conflicts || [];
  pullFiles = status.files || [];
  pullTotalCount = status.totalCount || 0;

  if (pullTotalCount === 0) {
    els.pullSummary.textContent = 'Checking complete';
    show(els.pullEmptyNotice);
    hide(els.pullFileSection);
    hide(els.pullConflictWarning);
  } else {
    const parts = [];
    if (pullOutdated.length > 0) {
      parts.push(`${pluralFiles(pullOutdated.length)} updated remotely`);
    }
    if (pullConflicts.length > 0) {
      parts.push(`${pluralFiles(pullConflicts.length)} changed locally and remotely`);
    }
    els.pullSummary.textContent = parts.join(', ');
    hide(els.pullEmptyNotice);
    show(els.pullFileSection);
    renderSyncPathList(els.pullFileList, pullFiles.map((f) => f.daPath));

    if (pullConflicts.length > 0) {
      els.pullConflictText.textContent = `${pluralFiles(pullConflicts.length)} changed both locally and remotely — skipped unless you choose to overwrite.`;
      renderSyncPathList(els.pullConflictList, pullConflicts);
      show(els.pullConflictWarning);
    } else {
      hide(els.pullConflictWarning);
    }
  }

  updatePullStartEnabled();
}

function formatPullCheckingSummary(checked, total) {
  if (total > 0) {
    return `Checking… ${checked.toLocaleString()} / ${total.toLocaleString()} synced file${total === 1 ? '' : 's'}`;
  }
  return 'Checking for remote changes…';
}

async function runPullCheck() {
  if (!syncFolder || !state.activeSiteId) {
    pullTotalCount = 0;
    updatePullStartEnabled();
    hide(els.pullEmptyNotice);
    hide(els.pullFileSection);
    hide(els.pullConflictWarning);
    els.pullSummary.textContent = 'Choose a local sync folder to pull remote changes.';
    return;
  }

  els.pullSummary.textContent = formatPullCheckingSummary(0, 0);
  els.pullStart.disabled = true;

  if (removePullCheckProgressListener) {
    removePullCheckProgressListener();
  }
  removePullCheckProgressListener = window.aemDesktop.onPullCheckProgress(({ checked, total }) => {
    els.pullSummary.textContent = formatPullCheckingSummary(checked, total);
  });

  try {
    const status = await window.aemDesktop.checkPull({
      siteId: state.activeSiteId,
      destFolder: syncFolder,
      includeBinaries: els.pullIncludeBinaries.checked,
    });

    els.pullOverwriteConflicts.checked = false;
    renderPullStatus(status);
  } catch (err) {
    pullTotalCount = 0;
    els.pullSummary.textContent = err.message || 'Check failed';
    hide(els.pullEmptyNotice);
    hide(els.pullFileSection);
    hide(els.pullConflictWarning);
    updatePullStartEnabled();
  } finally {
    if (removePullCheckProgressListener) {
      removePullCheckProgressListener();
      removePullCheckProgressListener = null;
    }
  }
}

function openPullModal() {
  resetPullModalState();
  updatePullFolderDisplay();
  show(els.pullModal);
  runPullCheck();
}

function closePullModal() {
  if (pulling) {
    window.aemDesktop.cancelPull();
  }
  if (removePullProgressListener) {
    removePullProgressListener();
    removePullProgressListener = null;
  }
  if (removePullCheckProgressListener) {
    removePullCheckProgressListener();
    removePullCheckProgressListener = null;
  }
  pulling = false;
  hide(els.pullModal);
  if (syncFolder && state.activeSiteId) {
    autoSyncCheck();
  }
}

function handlePullProgress(data) {
  if (data.phase === 'downloading') {
    const pct = data.total > 0
      ? Math.round((data.completed / data.total) * 100) : 0;
    els.pullProgressFill.style.width = `${pct}%`;
    const current = data.current ? displayPath(data.current) : '';
    els.pullProgressText.textContent = `${data.completed} / ${data.total}  ${current}`;
  } else if (data.phase === 'done') {
    els.pullProgressFill.style.width = '100%';
    els.pullProgressText.textContent = `Done — ${pluralFiles(data.total)} pulled`;
    pulling = false;
  }
}

function showPullCompleteActions() {
  pulling = false;
  els.pullStart.disabled = false;
  els.pullStart.textContent = 'Close';
  hide(els.pullCancel);
}

async function startPull() {
  if (!syncFolder || !state.activeSiteId || pullTotalCount === 0) {
    return;
  }

  const overwriteConflicts = els.pullOverwriteConflicts.checked;
  const filesToPull = pullFiles.filter((file) => (
    !file.conflict || overwriteConflicts
  ));

  if (filesToPull.length === 0) {
    return;
  }

  pulling = true;
  els.pullStart.disabled = true;
  els.pullIncludeBinaries.disabled = true;
  hide(els.pullEmptyNotice);
  hide(els.pullFileSection);
  hide(els.pullConflictWarning);
  show(els.pullProgress);
  els.pullProgressText.textContent = 'Starting…';

  removePullProgressListener = window.aemDesktop.onPullProgress(handlePullProgress);

  let pullSucceeded = false;
  try {
    const result = await window.aemDesktop.runPull({
      siteId: state.activeSiteId,
      destFolder: syncFolder,
      files: filesToPull.map(({ daPath, lastModified, ext }) => ({
        daPath,
        lastModified,
        ext,
      })),
    });

    if (result.cancelled) {
      els.pullProgressText.textContent = 'Cancelled';
      els.pullProgressFill.style.width = '0%';
      autoSyncCheck();
    } else {
      pullSucceeded = true;
      autoSyncCheck();
    }
  } catch (err) {
    els.pullProgressText.textContent = err.message || 'Pull failed';
  } finally {
    pulling = false;
    els.pullIncludeBinaries.disabled = false;
    if (removePullProgressListener) {
      removePullProgressListener();
      removePullProgressListener = null;
    }
    if (pullSucceeded) {
      showPullCompleteActions();
    } else {
      els.pullCancel.textContent = 'Close';
      updatePullStartEnabled();
    }
  }
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

function formatCheckingSummary(discovered) {
  return `Checking… ${discovered.toLocaleString()} file${discovered === 1 ? '' : 's'} found`;
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

  els.syncSelectionSummary.textContent = formatCheckingSummary(0);
  els.syncStart.disabled = true;

  let removeCheckProgressListener = null;
  removeCheckProgressListener = window.aemDesktop.onSyncCheckProgress(({ discovered }) => {
    els.syncSelectionSummary.textContent = formatCheckingSummary(discovered);
  });

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
  } finally {
    if (removeCheckProgressListener) {
      removeCheckProgressListener();
      removeCheckProgressListener = null;
    }
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
    updateSyncFolderDisplay();
    runSyncCheck();
  }
}

function handleSyncProgress(data) {
  if (data.phase === 'listing') {
    const discovered = data.discovered ?? 0;
    els.syncProgressText.textContent = discovered > 0
      ? `Listing… ${discovered.toLocaleString()} file${discovered === 1 ? '' : 's'} found`
      : 'Listing files…';
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

  let syncSucceeded = false;
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
    } else if (result.error) {
      els.syncProgressText.textContent = result.error.message;
      await showRequestErrorDialog('Sync failed', result.error);
    } else {
      syncSucceeded = true;
      if (result.syncedPath) {
        syncedPath = result.syncedPath;
      }
      autoSyncCheck();
    }
  } catch (err) {
    els.syncProgressText.textContent = err.message || 'Sync failed';
    await showRequestErrorDialog('Sync failed', err);
  } finally {
    syncing = false;
    els.syncPickFolder.disabled = false;
    if (removeSyncProgressListener) {
      removeSyncProgressListener();
      removeSyncProgressListener = null;
    }
    if (syncSucceeded) {
      showSyncCompleteActions();
    } else {
      els.syncCancel.textContent = 'Close';
      updateSyncStartEnabled();
    }
  }
}

let pushing = false;
let reverting = false;
/** @type {string[]} */
let lastPushedDaPaths = [];
let reviewDiffs = [];
/** @type {Set<string>} */
let reviewSelectedPaths = new Set();
let reviewAnchorPath = null;
let reviewFocusPath = null;
/** @type {Set<string>} */
let reviewCheckedPaths = new Set();
let removePushProgressListener = null;
let helix6Running = false;
let removeHelix6ProgressListener = null;
let removeRevertProgressListener = null;

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
    renderDiffView(els.reviewCodePane, file);
  }
  loadReviewPreview(daPath);
  if (reviewContentMode === 'document') {
    loadReviewDocument(daPath);
  }
  syncReviewContentView();
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
  updateReviewActionButtons();
}

function toggleReviewCheck(daPath, checked) {
  if (checked) {
    reviewCheckedPaths.add(daPath);
  } else {
    reviewCheckedPaths.delete(daPath);
  }
  paintReviewFileList();
  updateReviewActionButtons();
}

function checkedReviewDiffs() {
  return reviewDiffs.filter((d) => reviewCheckedPaths.has(d.daPath));
}

function updateReviewActionButtons({ forceDisabled = false } = {}) {
  const count = checkedReviewDiffs().length;
  const busy = pushing || reverting;
  els.reviewPush.disabled = forceDisabled || busy || count === 0;
  els.reviewRevert.disabled = forceDisabled || busy || count === 0;
  els.reviewPush.textContent = count > 0 && !forceDisabled
    ? `Push changes (${count})`
    : 'Push changes';
  els.reviewRevert.textContent = count > 0 && !forceDisabled
    ? `Revert selected (${count})`
    : 'Revert selected';
}

function renderReviewPlaceholder(message) {
  reviewPreview.destroy();
  reviewContentMode = loadStoredContentMode();
  els.reviewCodePane.replaceChildren();
  els.reviewPreviewPane.replaceChildren();
  els.reviewDocumentPane.replaceChildren();
  if (reviewContentMode === 'preview') {
    setPanePlaceholder(els.reviewPreviewPane, message);
  } else if (reviewContentMode === 'document') {
    setPanePlaceholder(els.reviewDocumentPane, message);
  } else {
    setPanePlaceholder(els.reviewCodePane, message);
  }
  syncReviewContentView();
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

  updateReviewActionButtons();
  paintReviewFileList();
  if (reviewFocusPath) {
    showReviewDiff(reviewFocusPath);
  } else {
    renderReviewPlaceholder('Select a file to see changes.');
  }
}

function resetReviewProgressUi() {
  hide(els.reviewProgress);
  hide(els.reviewPostPushActions);
  hide(els.reviewPreviewPublish);
  els.reviewProgressFill.style.width = '0%';
  els.reviewProgressText.textContent = '';
  els.reviewCopyPreviewUrls.textContent = 'Copy preview URLs';
  els.reviewCopyPreviewUrls.disabled = false;
  els.reviewCancel.textContent = 'Cancel';
  lastPushedDaPaths = [];
  pushing = false;
  reverting = false;
}

async function reloadReviewAfterPush() {
  const { empty, diffs } = await loadReviewChanges();
  paintFileTree();

  if (empty) {
    reviewDiffs = [];
    reviewSelectedPaths = new Set();
    reviewCheckedPaths = new Set();
    reviewFocusPath = null;
    reviewAnchorPath = null;
    paintReviewFileList();
    renderReviewPlaceholder('All changes pushed');
  } else {
    applyReviewDiffs(diffs, { preserveSelection: true });
  }

  autoSyncCheck();
}

async function copyReviewPreviewUrls() {
  if (!state.activeSiteId || lastPushedDaPaths.length === 0) {
    return;
  }

  try {
    const urls = await window.aemDesktop.buildAemPreviewUrls(
      state.activeSiteId,
      lastPushedDaPaths,
    );
    await navigator.clipboard.writeText(urls.join('\n'));
    els.reviewCopyPreviewUrls.textContent = 'Copied!';
    window.setTimeout(() => {
      if (els.reviewCopyPreviewUrls.textContent === 'Copied!') {
        els.reviewCopyPreviewUrls.textContent = 'Copy preview URLs';
      }
    }, 2000);
  } catch {
    els.reviewCopyPreviewUrls.textContent = 'Copy failed';
  }
}

function handleReviewCancelClick() {
  if (els.reviewCancel.textContent === 'Done') {
    resetReviewProgressUi();
    if (reviewDiffs.length === 0) {
      closeReviewView();
    } else {
      updateReviewActionButtons();
    }
    return;
  }
  closeReviewView();
}

async function openPushModal() {
  if (!syncFolder || !state.activeSiteId) {
    return;
  }

  pushing = false;
  reverting = false;
  reviewDiffs = [];
  reviewSelectedPaths = new Set();
  reviewAnchorPath = null;
  reviewFocusPath = null;
  reviewCheckedPaths = new Set();
  reviewContentMode = loadStoredContentMode();
  reviewPreview.destroy();
  els.reviewPush.disabled = true;
  els.reviewRevert.disabled = true;
  els.reviewPush.textContent = 'Push changes';
  els.reviewRevert.textContent = 'Revert selected';
  els.reviewCancel.textContent = 'Cancel';
  hide(els.reviewProgress);
  hide(els.reviewPostPushActions);
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
  if (reverting) {
    window.aemDesktop.cancelRevert();
  }
  if (removePushProgressListener) {
    removePushProgressListener();
    removePushProgressListener = null;
  }
  if (removeRevertProgressListener) {
    removeRevertProgressListener();
    removeRevertProgressListener = null;
  }
  resetReviewProgressUi();
  reviewPreview.destroy();
  reviewContentMode = loadStoredContentMode();
  reviewDiffs = [];
  reviewSelectedPaths = new Set();
  reviewAnchorPath = null;
  reviewFocusPath = null;
  reviewCheckedPaths = new Set();
  showView('browse');
  autoSyncCheck();
}

function handleReviewProgress(data) {
  if (data.phase === 'reverting') {
    const pct = data.total > 0
      ? Math.round((data.completed / data.total) * 100) : 0;
    els.reviewProgressFill.style.width = `${pct}%`;
    const current = data.current ? displayPath(data.current) : '';
    els.reviewProgressText.textContent = `Reverting ${data.completed} / ${data.total}  ${current}`;
  } else if (data.phase === 'uploading') {
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
    if (reverting) {
      els.reviewProgressText.textContent = `Done — ${pluralFiles(data.total)} reverted`;
      reverting = false;
      updateReviewActionButtons({ forceDisabled: true });
      els.reviewCancel.textContent = 'Done';
    } else {
      els.reviewProgressText.textContent = `Done — ${pluralFiles(data.total)} pushed`;
      pushing = false;
      updateReviewActionButtons({ forceDisabled: true });
      els.reviewCancel.textContent = 'Done';
      if (lastPushedDaPaths.length > 0) {
        showReviewPostPushActions();
      } else {
        hide(els.reviewPostPushActions);
      }
    }
  }
}

async function startRevert() {
  const selectedDiffs = checkedReviewDiffs();
  if (!syncFolder || !state.activeSiteId || selectedDiffs.length === 0) {
    return;
  }

  reverting = true;
  updateReviewActionButtons();
  show(els.reviewProgress);
  hide(els.reviewPostPushActions);
  els.reviewProgressText.textContent = `Starting — ${pluralFiles(selectedDiffs.length)}…`;

  removeRevertProgressListener = window.aemDesktop.onRevertProgress(handleReviewProgress);

  try {
    const result = await window.aemDesktop.runRevert({
      siteId: state.activeSiteId,
      destFolder: syncFolder,
      files: selectedDiffs.map(({ daPath, status }) => ({ daPath, status })),
    });

    if (result.cancelled) {
      els.reviewProgressText.textContent = 'Cancelled';
      els.reviewProgressFill.style.width = '0%';
    } else {
      await reloadReviewAfterPush();
    }
  } catch (err) {
    els.reviewProgressText.textContent = err.message || 'Revert failed';
  } finally {
    reverting = false;
    if (removeRevertProgressListener) {
      removeRevertProgressListener();
      removeRevertProgressListener = null;
    }
    if (els.reviewCancel.textContent !== 'Done') {
      updateReviewActionButtons();
    }
  }
}

async function startPush() {
  const selectedDiffs = checkedReviewDiffs();
  if (!syncFolder || !state.activeSiteId || selectedDiffs.length === 0) {
    return;
  }

  pushing = true;
  updateReviewActionButtons();
  show(els.reviewProgress);
  els.reviewProgressText.textContent = `Starting — ${pluralFiles(selectedDiffs.length)}…`;

  removePushProgressListener = window.aemDesktop.onPushProgress(handleReviewProgress);

  const filesToPush = selectedDiffs
    .filter((d) => d.status !== 'deleted')
    .map((d) => d.daPath);
  const filesToDelete = selectedDiffs
    .filter((d) => d.status === 'deleted')
    .map((d) => d.daPath);

  lastPushedDaPaths = filesToPush;
  hide(els.reviewPostPushActions);

  try {
    const result = await window.aemDesktop.runPush({
      siteId: state.activeSiteId,
      destFolder: syncFolder,
      filesToPush,
      filesToDelete,
    });

    if (result.cancelled) {
      lastPushedDaPaths = [];
      els.reviewProgressText.textContent = 'Cancelled';
      els.reviewProgressFill.style.width = '0%';
    } else if (result.error) {
      lastPushedDaPaths = [];
      els.reviewProgressText.textContent = result.error.message;
      hide(els.reviewPostPushActions);
      await showRequestErrorDialog('Push failed', result.error);
    } else {
      await reloadReviewAfterPush();
    }
  } catch (err) {
    lastPushedDaPaths = [];
    els.reviewProgressText.textContent = err.message || 'Push failed';
    hide(els.reviewPostPushActions);
    await showRequestErrorDialog('Push failed', err);
  } finally {
    pushing = false;
    if (removePushProgressListener) {
      removePushProgressListener();
      removePushProgressListener = null;
    }
    if (els.reviewCancel.textContent !== 'Done') {
      updateReviewActionButtons();
    }
  }
}

function selectedHelix6Mode() {
  const checked = els.helix6Modal.querySelector('input[name="helix6-mode"]:checked');
  return checked?.value || 'preview';
}

function populateHelix6PathList() {
  els.helix6PathList.replaceChildren();
  for (const daPath of lastPushedDaPaths) {
    const li = document.createElement('li');
    li.textContent = displayPath(daPath);
    els.helix6PathList.append(li);
  }
}

function resetHelix6ModalUi() {
  hide(els.helix6Progress);
  hide(els.helix6Error);
  els.helix6ProgressFill.style.width = '0%';
  els.helix6ProgressText.textContent = '';
  els.helix6Start.disabled = false;
  els.helix6Cancel.textContent = 'Cancel';
  helix6Running = false;
}

function openHelix6Modal() {
  if (!isHelix6Site() || lastPushedDaPaths.length === 0) {
    return;
  }
  resetHelix6ModalUi();
  populateHelix6PathList();
  const previewRadio = els.helix6Modal.querySelector('input[value="preview"]');
  if (previewRadio) {
    previewRadio.checked = true;
  }
  show(els.helix6Modal);
}

function closeHelix6Modal() {
  if (helix6Running) {
    window.aemDesktop.cancelHelix6Bulk();
  }
  hide(els.helix6Modal);
  resetHelix6ModalUi();
}

function formatHelix6Progress(data) {
  if (data.phase === 'starting') {
    const action = data.mode === 'preview-publish' ? 'preview and publish' : 'preview';
    return `Starting ${action} for ${data.pathCount} path(s)…`;
  }
  if (data.phase === 'job') {
    const label = data.topic === 'publish' ? 'Publishing' : 'Previewing';
    const prog = data.progress;
    if (prog && typeof prog.total === 'number') {
      const processed = prog.processed ?? 0;
      const failed = prog.failed ?? 0;
      const failedPart = failed > 0 ? ` (${failed} failed)` : '';
      return `${label}… ${processed} / ${prog.total}${failedPart}`;
    }
    return `${label}… (${data.state || 'running'})`;
  }
  if (data.phase === 'done') {
    return data.mode === 'preview-publish'
      ? 'Preview and publish complete'
      : 'Preview complete';
  }
  return '';
}

function handleHelix6Progress(data) {
  const text = formatHelix6Progress(data);
  if (text) {
    els.helix6ProgressText.textContent = text;
  }
  if (data.phase === 'job' && data.progress?.total > 0) {
    const processed = data.progress.processed ?? 0;
    const pct = Math.round((processed / data.progress.total) * 100);
    els.helix6ProgressFill.style.width = `${pct}%`;
  } else if (data.phase === 'done') {
    els.helix6ProgressFill.style.width = '100%';
  }
}

async function startHelix6Bulk() {
  if (!state.activeSiteId || lastPushedDaPaths.length === 0 || helix6Running) {
    return;
  }

  helix6Running = true;
  els.helix6Start.disabled = true;
  hide(els.helix6Error);
  show(els.helix6Progress);
  els.helix6ProgressFill.style.width = '0%';
  els.helix6ProgressText.textContent = 'Starting…';

  removeHelix6ProgressListener = window.aemDesktop.onHelix6BulkProgress(handleHelix6Progress);

  try {
    const result = await window.aemDesktop.runHelix6Bulk({
      siteId: state.activeSiteId,
      daPaths: lastPushedDaPaths,
      mode: selectedHelix6Mode(),
    });
    if (result.cancelled) {
      els.helix6ProgressText.textContent = 'Cancelled';
      els.helix6ProgressFill.style.width = '0%';
    } else if (result.error) {
      els.helix6Error.textContent = result.error.message;
      show(els.helix6Error);
      els.helix6ProgressText.textContent = 'Failed';
      await showRequestErrorDialog('Preview/publish failed', result.error);
    } else {
      els.helix6Cancel.textContent = 'Close';
    }
  } catch (err) {
    els.helix6Error.textContent = err.message || 'Preview/publish failed';
    show(els.helix6Error);
    els.helix6ProgressText.textContent = 'Failed';
    await showRequestErrorDialog('Preview/publish failed', err);
  } finally {
    helix6Running = false;
    els.helix6Start.disabled = false;
    if (removeHelix6ProgressListener) {
      removeHelix6ProgressListener();
      removeHelix6ProgressListener = null;
    }
  }
}

function handleHelix6CancelClick() {
  if (helix6Running) {
    window.aemDesktop.cancelHelix6Bulk();
    return;
  }
  if (els.helix6Cancel.textContent === 'Close') {
    closeHelix6Modal();
    return;
  }
  closeHelix6Modal();
}

function wireUi() {
  els.navHome.addEventListener('click', goHome);

  els.addSiteToggle.addEventListener('click', () => {
    show(els.addSiteForm);
    els.siteUrlInput.focus();
  });

  els.addSiteCancel.addEventListener('click', () => {
    hide(els.addSiteForm);
    resetAddSiteForm();
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

    // Dev only: ⌥⌘I opens preview webview DevTools, ⌥⌘D opens app DevTools.
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === 'KeyI') {
      event.preventDefault();
      openPreviewDevTools();
    }
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === 'KeyD') {
      event.preventDefault();
      window.aemDesktop.openAppDevTools();
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
  els.syncStart.addEventListener('click', () => {
    if (els.syncStart.textContent === 'Close') {
      closeSyncModal();
      return;
    }
    startSync();
  });
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

  els.pullStart.addEventListener('click', () => {
    if (els.pullStart.textContent === 'Close') {
      closePullModal();
      return;
    }
    startPull();
  });
  els.pullCancel.addEventListener('click', closePullModal);
  els.pullIncludeBinaries.addEventListener('change', () => {
    if (syncFolder && !pulling) {
      runPullCheck();
    }
  });
  els.pullOverwriteConflicts.addEventListener('change', updatePullStartEnabled);
  els.pullModal.addEventListener('click', (event) => {
    if (event.target === els.pullModal) {
      closePullModal();
    }
  });

  els.reviewPush.addEventListener('click', startPush);
  els.reviewRevert.addEventListener('click', startRevert);
  els.reviewCancel.addEventListener('click', handleReviewCancelClick);
  els.reviewCopyPreviewUrls.addEventListener('click', copyReviewPreviewUrls);
  els.reviewPreviewPublish.addEventListener('click', openHelix6Modal);
  els.contentSegmentPreview.addEventListener('click', () => {
    if (browseContentMode !== 'preview') {
      setBrowseContentMode('preview');
    }
  });
  els.contentSegmentCode.addEventListener('click', () => {
    if (els.contentSegmentCode.disabled || browseContentMode === 'code') {
      return;
    }
    setBrowseContentMode('code');
  });
  els.contentSegmentDocument.addEventListener('click', () => {
    if (browseContentMode === 'document') {
      return;
    }
    setBrowseContentMode('document');
  });
  els.reviewSegmentPreview.addEventListener('click', () => {
    if (reviewContentMode !== 'preview') {
      setReviewContentMode('preview');
    }
  });
  els.reviewSegmentCode.addEventListener('click', () => {
    if (reviewContentMode !== 'code') {
      setReviewContentMode('code');
    }
  });
  els.reviewSegmentDocument.addEventListener('click', () => {
    if (reviewContentMode !== 'document') {
      setReviewContentMode('document');
    }
  });
  els.helix6Start.addEventListener('click', startHelix6Bulk);
  els.helix6Cancel.addEventListener('click', handleHelix6CancelClick);
  els.helix6Modal.addEventListener('click', (event) => {
    if (event.target === els.helix6Modal && !helix6Running) {
      closeHelix6Modal();
    }
  });
  wireReviewKeyboard(els.reviewFileContainer, {
    onSelect: focusReviewFile,
    onSelectAll: selectAllReviewFiles,
    onToggleCheckSelection: toggleReviewCheckSelection,
  });

  window.addEventListener('dblclick', () => {
    window.aemDesktop.captureScreenshot();
  });
}

async function loadSyncFolderPreference() {
  syncFolder = await window.aemDesktop.getSyncFolder();
  if (!syncFolder) {
    try {
      const legacy = localStorage.getItem('syncFolder');
      if (legacy) {
        syncFolder = legacy;
        await window.aemDesktop.setSyncFolder(legacy);
        localStorage.removeItem('syncFolder');
      }
    } catch {
      /* localStorage unavailable */
    }
  }
  updateSyncFolderDisplay();
}

async function init() {
  wireUi();
  state.icons = await loadIcons();
  await loadSyncFolderPreference();
  updateBrowseCodeAvailability();
  syncReviewContentView();
  await refreshAuthStatus();
  await loadSites();
  window.aemDesktop.onPreviewAuthRequired(handlePreviewAuthRequired);
  showView('home');
}

init();
