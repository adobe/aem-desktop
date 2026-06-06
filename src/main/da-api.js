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

export const DA_ADMIN = 'https://admin.da.live';

/** Response header used to page past the per-request list limit. */
export const LIST_CONTINUATION_HEADER = 'da-continuation-token';

const LIST_MAX_PAGES = 50000;
const MAX_ERROR_BODY_LEN = 500;

/**
 * @param {string} method
 * @param {string} url
 * @param {Response} res
 * @param {string} [context]
 * @returns {Promise<string>}
 */
async function formatHttpError(method, url, res, context = '') {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === 'object' && parsed !== null) {
            detail = parsed.message || parsed.error || parsed.detail || JSON.stringify(parsed);
          } else {
            detail = trimmed;
          }
        } catch {
          detail = trimmed;
        }
      } else {
        detail = trimmed;
      }
      if (detail.length > MAX_ERROR_BODY_LEN) {
        detail = `${detail.slice(0, MAX_ERROR_BODY_LEN)}…`;
      }
    }
  } catch {
    // ignore body read failures
  }

  const prefix = context ? `${context}: ` : '';
  const statusPart = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  const parts = [`${prefix}${method} ${url} → ${statusPart}`];
  if (detail) {
    parts.push(detail);
  }
  if (res.status === 403) {
    parts.push('Forbidden — verify your token has access to this org/repo.');
  }
  return parts.join(' — ');
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
 * HTTP client for the DA admin API (list + source).
 */
export class DaClient {
  /**
   * @param {string} token IMS Bearer token
   * @param {typeof fetch} [fetchImpl]
   */
  constructor(token, fetchImpl = globalThis.fetch) {
    this.token = token;
    this.fetch = fetchImpl;
  }

  get authHeader() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Lists directory contents, following pagination headers until complete.
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<Array<{path: string, name: string, ext?: string, lastModified?: string}>>}
   */
  async list(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = `${DA_ADMIN}/list/${org}/${repo}${normalized === '/' ? '/' : normalized}`;
    const aggregated = [];
    let continuation = null;

    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const headers = { ...this.authHeader };
      if (continuation) {
        headers[LIST_CONTINUATION_HEADER] = continuation;
      }
      const res = await this.fetch(url, { headers, cache: 'reload' }); // eslint-disable-line no-await-in-loop
      if (res.status === 401) {
        throw new Error('Unauthorized: invalid or expired token');
      }
      if (!res.ok) {
        throw new Error(await formatHttpError('GET', url, res, `List failed for ${normalized}`)); // eslint-disable-line no-await-in-loop
      }
      const body = await res.json(); // eslint-disable-line no-await-in-loop
      if (!Array.isArray(body)) {
        throw new Error(`List response for ${normalized} must be a JSON array`);
      }
      aggregated.push(...body);

      const next = res.headers.get(LIST_CONTINUATION_HEADER);
      if (!next || next === continuation) {
        return aggregated;
      }
      continuation = next;
    }

    return aggregated;
  }

  /**
   * Downloads raw file bytes (text or binary).
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<{ contentType: string, buffer: ArrayBuffer }|null>}
   */
  async downloadRaw(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = `${DA_ADMIN}/source/${org}/${repo}${normalized}`;
    const res = await this.fetch(url, { headers: this.authHeader, cache: 'reload' });
    if (res.status === 401) {
      throw new Error('Unauthorized: invalid or expired token');
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(await formatHttpError('GET', url, res, `Download failed for ${normalized}`));
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = await res.arrayBuffer();
    return { contentType, buffer };
  }

  /**
   * Fetches raw file content.
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<{ contentType: string, body: string, isText: boolean }|null>}
   */
  async getSource(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = `${DA_ADMIN}/source/${org}/${repo}${normalized}`;
    const res = await this.fetch(url, { headers: this.authHeader, cache: 'reload' });
    if (res.status === 401) {
      throw new Error('Unauthorized: invalid or expired token');
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(await formatHttpError('GET', url, res, `GET failed for ${normalized}`));
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const isText = contentType.startsWith('text/')
      || contentType.includes('json')
      || contentType.includes('javascript')
      || contentType.includes('xml');

    if (!isText) {
      return { contentType, body: '', isText: false };
    }

    const body = await res.text();
    return { contentType, body, isText: true };
  }

  /**
   * Uploads a file to the DA source endpoint.
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @param {Buffer|ArrayBuffer} data
   * @param {string} contentType
   * @returns {Promise<void>}
   */
  async uploadSource(org, repo, daPath, data, contentType) {
    const normalized = normalizeDaPath(daPath);
    const url = `${DA_ADMIN}/source/${org}/${repo}${normalized}`;
    const body = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const res = await this.fetch(url, {
      method: 'PUT',
      headers: { ...this.authHeader, 'Content-Type': contentType },
      body,
    });
    if (res.status === 401) {
      throw new Error('Unauthorized: invalid or expired token');
    }
    if (!res.ok) {
      throw new Error(await formatHttpError('PUT', url, res, `Upload failed for ${normalized}`));
    }
  }

  /**
   * Deletes a file from the DA source endpoint.
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<void>}
   */
  async deleteSource(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = `${DA_ADMIN}/source/${org}/${repo}${normalized}`;
    const res = await this.fetch(url, {
      method: 'DELETE',
      headers: this.authHeader,
    });
    if (res.status === 401) {
      throw new Error('Unauthorized: invalid or expired token');
    }
    if (!res.ok && res.status !== 404) {
      throw new Error(await formatHttpError('DELETE', url, res, `Delete failed for ${normalized}`));
    }
  }
}
