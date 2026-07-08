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
import { buildDesktopRumPath, desktopRumReferer } from './rum-paths.js';

const RUM_STANDALONE_PATH = '/.rum/@adobe/helix-rum-js@^2/dist/rum-standalone.js';

/**
 * Loads helix-rum-js through the local `/.rum` proxy. Sampling, `top`, and `click`
 * behave like a normal page load; virtual pageviews call {@link trackDesktopPageView}.
 *
 * @param {() => Promise<string|null|undefined>} getBaseUrl
 */
export async function initDesktopRum(getBaseUrl) {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    return;
  }

  window.RUM_BASE = baseUrl.replace(/\/+$/, '');

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.defer = true;
    script.src = `${window.RUM_BASE}${RUM_STANDALONE_PATH}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load helix-rum-js'));
    document.head.append(script);
  });
}

/**
 * Cooperative virtual pageview for the desktop shell SPA. Uses stock `sampleRUM`
 * so enhancer click tracking stays wired for sampled sessions.
 *
 * @param {{
 *   view: 'home'|'browse'|'review',
 *   site?: { org?: string, repo?: string }|null,
 *   daPath?: string|null,
 * }} options
 */
export function trackDesktopPageView({ view, site = null, daPath = null }) {
  const rum = window.hlx?.rum;
  if (!rum?.isSelected) {
    return;
  }
  const { sampleRUM } = rum;
  if (typeof sampleRUM !== 'function') {
    return;
  }

  const virtualPath = buildDesktopRumPath(view, site, daPath);
  sampleRUM('top', { referer: desktopRumReferer(virtualPath) });
}
