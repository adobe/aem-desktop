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

// helix-rum-js sampling rates → weight: on=1 (100%), high=10 (10%),
// medium=100 (1%), low=1000 (0.1%), off=0. Dev samples at 10% so telemetry is
// exercised without beaconing every interaction; production (unset) keeps the
// library default of 100 (1%).
const DEV_SAMPLE_RATE = 'high';
const VALID_SAMPLE_RATES = new Set(['on', 'off', 'high', 'medium', 'low']);

/**
 * Loads helix-rum-js through the local `/.rum` proxy. Sampling, `top`, and `click`
 * behave like a normal page load; virtual pageviews call {@link trackDesktopPageView}.
 *
 * @param {() => Promise<string|null|undefined>} getBaseUrl
 * @param {() => Promise<boolean>} [isDev]
 */
export async function initDesktopRum(getBaseUrl, isDev = async () => false) {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    return;
  }

  window.RUM_BASE = baseUrl.replace(/\/+$/, '');

  // file:// shell has no query string, so opt into sampling via a localStorage
  // rate override (rum/optel = on|off|high|medium|low); otherwise dev falls
  // back to DEV_SAMPLE_RATE and production uses the library default.
  try {
    const override = localStorage.getItem('rum') || localStorage.getItem('optel');
    if (override && VALID_SAMPLE_RATES.has(override)) {
      window.SAMPLE_PAGEVIEWS_AT_RATE = override;
    }
  } catch {
    // localStorage unavailable
  }
  if (!window.SAMPLE_PAGEVIEWS_AT_RATE && await isDev()) {
    window.SAMPLE_PAGEVIEWS_AT_RATE = DEV_SAMPLE_RATE;
  }

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
