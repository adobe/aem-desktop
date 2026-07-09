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
import { DESKTOP_RUM_ORIGIN } from '../rum-config.js';

/**
 * @param {string} daPath
 * @returns {string}
 */
export function normalizeDaPathForRum(daPath) {
  if (!daPath || daPath === '/') {
    return '';
  }
  return daPath.startsWith('/') ? daPath : `/${daPath}`;
}

/**
 * Builds the virtual path segment reported to RUM for a desktop shell view.
 *
 * @param {'home'|'browse'|'review'} view
 * @param {{ org?: string, repo?: string }|null|undefined} site
 * @param {string|undefined|null} daPath
 * @returns {string}
 */
export function buildDesktopRumPath(view, site, daPath) {
  if (view === 'home') {
    return '/';
  }
  if (!site?.org || !site?.repo) {
    return '/';
  }
  const base = `/sites/${site.org}/${site.repo}`;
  if (view === 'review') {
    return `${base}/review`;
  }
  if (view === 'browse') {
    const suffix = normalizeDaPathForRum(daPath || '');
    if (suffix) {
      return `${base}/content${suffix}`;
    }
    return base;
  }
  return '/';
}

/**
 * @param {string} virtualPath
 * @returns {string}
 */
export function desktopRumReferer(virtualPath) {
  if (!virtualPath || virtualPath === '/') {
    return `${DESKTOP_RUM_ORIGIN}/`;
  }
  const path = virtualPath.startsWith('/') ? virtualPath : `/${virtualPath}`;
  return `${DESKTOP_RUM_ORIGIN}${path}`;
}
