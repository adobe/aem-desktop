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

import {
  buildAemApiBulkPreviewUrl,
  buildAemApiBulkPublishUrl,
  buildAemApiJobUrl,
  buildAemApiListUrl,
  buildAemApiSourceUrl,
  normalizeAemApiListEntry,
} from './aem-admin-api.js';
import {
  API_BACKEND_AEM_API,
  API_BACKEND_DA_LIVE,
  buildPostUploadRequest,
  DA_UNAUTHORIZED_MESSAGE,
  isValidApiBackend,
  normalizeDaPath,
} from './content-api-shared.js';
import {
  buildDaLiveListUrl,
  buildDaLiveSourceUrl,
  LIST_CONTINUATION_HEADER,
} from './da-live-api.js';
import { buildHttpError } from './http-request-error.js';

const LIST_MAX_PAGES = 50000;

/**
 * HTTP client for da.live admin and api.aem.live (helix6) content APIs.
 */
export class ContentApiClient {
  /**
   * @param {string} token IMS Bearer token
   * @param {string} [backend]
   * @param {typeof fetch} [fetchImpl]
   */
  constructor(token, backend = API_BACKEND_DA_LIVE, fetchImpl = globalThis.fetch) {
    this.token = token;
    this.backend = isValidApiBackend(backend) ? backend : API_BACKEND_DA_LIVE;
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
    if (this.backend === API_BACKEND_AEM_API) {
      return this.listAemApi(org, repo, daPath);
    }
    return this.listDaLive(org, repo, daPath);
  }

  /**
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<Array<{path: string, name: string, ext?: string, lastModified?: string}>>}
   */
  async listDaLive(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = buildDaLiveListUrl(org, repo, normalized);
    const aggregated = [];
    let continuation = null;

    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const headers = { ...this.authHeader };
      if (continuation) {
        headers[LIST_CONTINUATION_HEADER] = continuation;
      }
      const res = await this.fetch(url, { headers, cache: 'reload' }); // eslint-disable-line no-await-in-loop
      if (res.status === 401) {
        throw new Error(DA_UNAUTHORIZED_MESSAGE);
      }
      if (!res.ok) {
        throw await buildHttpError('GET', url, res, `List failed for ${normalized}`); // eslint-disable-line no-await-in-loop
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
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<Array<{path: string, name: string, ext?: string, lastModified?: string}>>}
   */
  async listAemApi(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = buildAemApiListUrl(org, repo, normalized);
    const res = await this.fetch(url, { headers: this.authHeader, cache: 'reload' });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (!res.ok) {
      throw await buildHttpError('GET', url, res, `List failed for ${normalized}`);
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`List response for ${normalized} must be a JSON array`);
    }
    return body.map((entry) => normalizeAemApiListEntry(entry, org, repo, normalized));
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
    const url = this.backend === API_BACKEND_AEM_API
      ? buildAemApiSourceUrl(org, repo, normalized)
      : buildDaLiveSourceUrl(org, repo, normalized);
    const res = await this.fetch(url, { headers: this.authHeader, cache: 'reload' });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw await buildHttpError('GET', url, res, `Download failed for ${normalized}`);
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
    const url = this.backend === API_BACKEND_AEM_API
      ? buildAemApiSourceUrl(org, repo, normalized)
      : buildDaLiveSourceUrl(org, repo, normalized);
    const res = await this.fetch(url, { headers: this.authHeader, cache: 'reload' });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw await buildHttpError('GET', url, res, `GET failed for ${normalized}`);
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
   * Uploads a file to the source endpoint.
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
    const url = this.backend === API_BACKEND_AEM_API
      ? buildAemApiSourceUrl(org, repo, normalized)
      : buildDaLiveSourceUrl(org, repo, normalized);
    const body = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

    const putRes = await this.fetch(url, {
      method: 'PUT',
      headers: { ...this.authHeader, 'Content-Type': contentType },
      body,
    });
    if (putRes.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (putRes.ok) {
      return;
    }
    if (putRes.status === 400) {
      const post = buildPostUploadRequest(this.backend, body, contentType, normalized);
      const postRes = await this.fetch(url, {
        method: 'POST',
        headers: { ...this.authHeader, ...post.headers },
        body: post.body,
      });
      if (postRes.status === 401) {
        throw new Error(DA_UNAUTHORIZED_MESSAGE);
      }
      if (postRes.ok) {
        return;
      }
      throw await buildHttpError('POST', url, postRes, `Upload failed for ${normalized}`);
    }
    throw await buildHttpError('PUT', url, putRes, `Upload failed for ${normalized}`);
  }

  /**
   * Deletes a file from the source endpoint.
   *
   * @param {string} org
   * @param {string} repo
   * @param {string} daPath
   * @returns {Promise<void>}
   */
  async deleteSource(org, repo, daPath) {
    const normalized = normalizeDaPath(daPath);
    const url = this.backend === API_BACKEND_AEM_API
      ? buildAemApiSourceUrl(org, repo, normalized)
      : buildDaLiveSourceUrl(org, repo, normalized);
    const res = await this.fetch(url, {
      method: 'DELETE',
      headers: this.authHeader,
    });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (!res.ok && res.status !== 404) {
      throw await buildHttpError('DELETE', url, res, `Delete failed for ${normalized}`);
    }
  }

  /**
   * @param {string} org
   * @param {string} repo
   * @param {string[]} paths
   * @returns {Promise<object>}
   */
  async startBulkPreview(org, repo, paths) {
    this.assertHelix6Backend();
    const url = buildAemApiBulkPreviewUrl(org, repo);
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { ...this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, forceAsync: true }),
    });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (!res.ok && res.status !== 202) {
      throw await buildHttpError('POST', url, res, 'Bulk preview failed');
    }
    return res.json();
  }

  /**
   * @param {string} org
   * @param {string} repo
   * @param {string[]} paths
   * @returns {Promise<object>}
   */
  async startBulkPublish(org, repo, paths) {
    this.assertHelix6Backend();
    const url = buildAemApiBulkPublishUrl(org, repo);
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { ...this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, forceAsync: true }),
    });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (!res.ok && res.status !== 202) {
      throw await buildHttpError('POST', url, res, 'Bulk publish failed');
    }
    return res.json();
  }

  /**
   * @param {string} org
   * @param {string} repo
   * @param {string} topic
   * @param {string} jobName
   * @returns {Promise<object>}
   */
  async getJobStatus(org, repo, topic, jobName) {
    this.assertHelix6Backend();
    const url = buildAemApiJobUrl(org, repo, topic, jobName);
    const res = await this.fetch(url, { headers: this.authHeader });
    if (res.status === 401) {
      throw new Error(DA_UNAUTHORIZED_MESSAGE);
    }
    if (!res.ok && res.status !== 202) {
      throw await buildHttpError('GET', url, res, 'Job status failed');
    }
    return res.json();
  }

  assertHelix6Backend() {
    if (this.backend !== API_BACKEND_AEM_API) {
      throw new Error('Bulk preview/publish requires api.aem.live (helix6)');
    }
  }
}
