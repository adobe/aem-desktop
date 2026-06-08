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
import http from 'node:http';
import {
  readFile, writeFile, mkdir, unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';

export const IMS_ORIGIN = 'https://ims-na1.adobelogin.com';
export const CLIENT_ID = 'darkalley';
export const SCOPE = 'ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read';
export const CALLBACK_PORT = 9898;
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
export const DA_TOKEN_FILENAME = '.da-token.json';

/**
 * @param {string} tokenPath
 * @returns {Promise<{ access_token: string, expires_at?: number }|null>}
 */
export async function loadStoredToken(tokenPath) {
  try {
    const raw = await readFile(tokenPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {{ access_token?: string, expires_at?: number|null }|null} stored
 * @returns {boolean}
 */
export function isTokenExpired(stored) {
  if (!stored?.access_token) {
    return true;
  }
  if (stored.expires_at) {
    return Date.now() >= (stored.expires_at - 60_000);
  }
  return true;
}

/**
 * @param {string} tokenPath
 * @param {{ access_token: string, expires_at?: number|null }} tokenData
 */
export async function saveToken(tokenPath, tokenData) {
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${JSON.stringify(tokenData, null, 2)}\n`, 'utf8');
}

/**
 * Builds the IMS authorize URL for the implicit OAuth flow.
 *
 * @returns {string}
 */
export function buildAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: CLIENT_ID,
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
  });
  return `${IMS_ORIGIN}/ims/authorize/v2?${params}`;
}

/**
 * Starts a local HTTP server that handles the implicit flow callback.
 *
 * @returns {Promise<{ token: string, expiresIn: number|null }>}
 */
export function waitForToken() {
  return new Promise((resolve, reject) => {
    let timeout;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>Logging in...</title></head><body>
<script>
  const p = new URLSearchParams(window.location.hash.substring(1));
  const token = p.get('access_token');
  const expiresIn = p.get('expires_in');
  const error = p.get('error');
  const dest = token
    ? '/token?access_token=' + encodeURIComponent(token) + (expiresIn ? '&expires_in=' + encodeURIComponent(expiresIn) : '')
    : '/token?error=' + encodeURIComponent(error || 'unknown');
  const loggedInUrl = 'https://tools.aem.live/cli/logged-in';
  if (!token) {
    fetch(dest);
    document.body.innerHTML = '<h2>Login failed.</h2>';
    const errP = document.createElement('p');
    errP.textContent = error || 'Unknown error';
    document.body.appendChild(errP);
  } else {
    fetch(dest)
      .then(() => { window.location.href = loggedInUrl; })
      .catch(() => {
        document.body.innerHTML = '<h2>Login failed.</h2><p>Could not complete login.</p>';
      });
  }
</script></body></html>`);
        return;
      }

      if (url.pathname === '/token') {
        const token = url.searchParams.get('access_token');
        const expiresIn = url.searchParams.get('expires_in');
        const error = url.searchParams.get('error');
        res.writeHead(200);
        res.end();
        clearTimeout(timeout);
        server.close();
        if (token) {
          resolve({ token, expiresIn: expiresIn ? parseInt(expiresIn, 10) : null });
        } else {
          reject(new Error(`Login failed: ${error || 'unknown error'}`));
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(CALLBACK_PORT, 'localhost');
    server.on('error', (err) => reject(new Error(`Could not start callback server on port ${CALLBACK_PORT}: ${err.message}`)));

    timeout = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out (5 minutes). Please try again.'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Returns a valid DA access token, triggering browser login when needed.
 *
 * @param {{ tokenPath: string, openBrowser: (url: string) => Promise<void>|void }} options
 * @returns {Promise<string>}
 */
export async function getValidToken({ tokenPath, openBrowser }) {
  const stored = await loadStoredToken(tokenPath);
  if (stored?.access_token && !isTokenExpired(stored)) {
    return stored.access_token;
  }

  const authUrl = buildAuthUrl();
  await openBrowser(authUrl);
  const { token, expiresIn } = await waitForToken();

  await saveToken(tokenPath, {
    access_token: token,
    expires_at: expiresIn ? Date.now() + (expiresIn * 1000) : null,
  });

  return token;
}

/**
 * @param {string} tokenPath
 * @returns {Promise<{ authenticated: boolean, expiresAt: number|null }>}
 */
export async function getAuthStatus(tokenPath) {
  const stored = await loadStoredToken(tokenPath);
  if (!stored?.access_token) {
    return { authenticated: false, expiresAt: null };
  }
  return {
    authenticated: !isTokenExpired(stored),
    expiresAt: stored.expires_at ?? null,
  };
}

/**
 * Removes the persisted DA token.
 *
 * @param {string} tokenPath
 */
export async function clearStoredToken(tokenPath) {
  try {
    await unlink(tokenPath);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * @param {string} tokenPath
 * @returns {Promise<{ authenticated: boolean, expiresAt: number|null }>}
 */
export async function logout(tokenPath) {
  await clearStoredToken(tokenPath);
  return getAuthStatus(tokenPath);
}
