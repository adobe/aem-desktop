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

export const API_BACKEND_DA_LIVE = 'da.live';
export const API_BACKEND_AEM_API = 'api.aem.live';

/** Thrown when da.live / api.aem.live rejects the IMS bearer token. */
export const DA_UNAUTHORIZED_MESSAGE = 'Unauthorized: invalid or expired token';

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isDaUnauthorizedError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(DA_UNAUTHORIZED_MESSAGE);
}

/**
 * @param {string} backend
 * @returns {boolean}
 */
export function isValidApiBackend(backend) {
  return backend === API_BACKEND_DA_LIVE || backend === API_BACKEND_AEM_API;
}

/**
 * Normalizes a DA path: leading slash, no trailing slash except root.
 *
 * @param {string} daPath
 * @returns {string}
 */
export function normalizeDaPath(daPath) {
  if (!daPath || daPath === '/') {
    return '/';
  }
  const withSlash = daPath.startsWith('/') ? daPath : `/${daPath}`;
  return withSlash.replace(/\/+$/, '') || '/';
}

/**
 * Repo-relative path without a leading slash (empty string for root).
 *
 * @param {string} daPath
 * @returns {string}
 */
export function toApiRelativePath(daPath) {
  const normalized = normalizeDaPath(daPath);
  if (normalized === '/') {
    return '';
  }
  return normalized.slice(1);
}

/**
 * Builds the POST upload request body for source create (interns external images).
 *
 * @param {string} backend
 * @param {Buffer|Uint8Array|ArrayBuffer} data
 * @param {string} contentType
 * @param {string} daPath
 * @returns {{ headers: Record<string, string>, body: BodyInit }}
 */
export function buildPostUploadRequest(backend, data, contentType, daPath) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (backend === API_BACKEND_AEM_API) {
    return {
      headers: { 'Content-Type': contentType },
      body: bytes,
    };
  }

  const rel = toApiRelativePath(normalizeDaPath(daPath));
  const name = rel.split('/').pop() || 'file';
  const form = new FormData();
  form.append('data', new Blob([bytes], { type: contentType }), name);
  return { headers: {}, body: form };
}
