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

// Preload for the dedicated, short-lived "Sign in to preview" window only.
// The AEM admin login page hands the AEM Sidekick its tokens by calling
// `chrome.runtime.sendMessage(extensionId, { authToken, siteToken, ... })`.
// A non-extension Electron window has no chrome.runtime, so we shim it here to
// capture the delivered siteToken. This window is loaded with contextIsolation
// disabled (see preview-login.js) so the shim lives in the page's main world
// where the admin script will find it; it only ever loads the trusted
// admin.hlx.page / Adobe IMS login URLs.
const { ipcRenderer } = require('electron');

// Mirror of ALLOWED_LOGIN_HOST_SUFFIXES in preview-login-url.js — the admin
// service and known identity providers. A window 'message' from any other
// origin is ignored so a stray frame can't inject a forged site token.
const ALLOWED_ORIGIN_SUFFIXES = [
  'hlx.page', 'aem.live', 'aem.page', 'adobelogin.com', 'adobe.com', 'adobe.io',
  'adobe.net', 'behance.net', 'microsoftonline.com', 'live.com', 'google.com',
  'googleusercontent.com', 'okta.com',
];

function isAllowedOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:') {
      return false;
    }
    return ALLOWED_ORIGIN_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function looksLikeTokenPayload(message) {
  return Boolean(message && typeof message === 'object'
    && (message.siteToken || message.authToken || message.token));
}

function relay(message) {
  if (looksLikeTokenPayload(message)) {
    try {
      ipcRenderer.send('preview-login:message', message);
    } catch {
      /* window may be tearing down; ignore */
    }
  }
}

const chromeShim = window.chrome || {};
const runtimeShim = chromeShim.runtime || {};
const realSend = typeof runtimeShim.sendMessage === 'function'
  ? runtimeShim.sendMessage.bind(runtimeShim)
  : null;

runtimeShim.id = runtimeShim.id || 'aem-desktop-preview-login';
runtimeShim.sendMessage = (...args) => {
  // Signatures: (extensionId, message, options?, callback?) or (message, callback?).
  const message = typeof args[0] === 'string' ? args[1] : args[0];
  relay(message);
  const callback = args.find((arg) => typeof arg === 'function');
  if (callback) {
    try {
      callback({ received: true });
    } catch {
      /* ignore */
    }
  }
  if (realSend) {
    try {
      return realSend(...args);
    } catch {
      /* ignore */
    }
  }
  return Promise.resolve({ received: true });
};

chromeShim.runtime = runtimeShim;
window.chrome = chromeShim;

// Some flows post the payload to the window instead of using chrome.runtime.
// Only accept messages from the admin/IdP origins.
window.addEventListener('message', (event) => {
  if (event && isAllowedOrigin(event.origin)) {
    relay(event.data);
  }
});
