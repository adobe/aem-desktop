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

/**
 * @param {string} previewUrl
 * @returns {string}
 */
export function previewUrlOrigin(previewUrl) {
  return new URL(previewUrl).origin;
}

/**
 * Keeps one localhost preview proxy per upstream .aem.page origin so switching
 * sites with different preview URLs gets a fresh port (and webview cache partition).
 *
 * @param {{
 *   startPreviewServer: typeof import('./preview-server.js').startPreviewServer,
 *   createHeadHtmlCache: typeof import('./head-html.js').createHeadHtmlCache,
 *   getSyncFolder: () => Promise<string|null>,
 *   resolveActiveSite: (siteId: string) => Promise<{
 *     org: string,
 *     repo: string,
 *     previewUrl: string,
 *   }|null>,
 *   log?: import('electron-log').MainLogger,
 * }} deps
 */
export function createPreviewServerRegistry(deps) {
  /** @type {Map<string, {
   *   baseUrl: string,
   *   close: () => Promise<void>,
   *   headHtmlCache: ReturnType<typeof deps.createHeadHtmlCache>,
   * }>} */
  const serversByOrigin = new Map();

  let activeSiteId = null;
  let activeUpstreamOrigin = null;
  let activeBaseUrl = null;

  async function ensureServer(upstreamOrigin) {
    const existing = serversByOrigin.get(upstreamOrigin);
    if (existing) {
      return existing;
    }

    const headHtmlCache = deps.createHeadHtmlCache();
    const server = await deps.startPreviewServer({
      log: deps.log,
      headHtmlCache,
      getActiveSite: async () => {
        if (!activeSiteId) {
          return null;
        }
        const site = await deps.resolveActiveSite(activeSiteId);
        if (!site) {
          return null;
        }
        try {
          if (previewUrlOrigin(site.previewUrl) !== upstreamOrigin) {
            return null;
          }
        } catch {
          return null;
        }
        return site;
      },
      getSyncFolder: deps.getSyncFolder,
    });

    const entry = {
      baseUrl: server.baseUrl,
      close: server.close,
      headHtmlCache,
    };
    serversByOrigin.set(upstreamOrigin, entry);
    if (deps.log?.info) {
      deps.log.info(`Preview proxy for ${upstreamOrigin} listening on ${entry.baseUrl}`);
    }
    return entry;
  }

  return {
    /**
     * @param {string|null} siteId
     * @param {{ org: string, repo: string, previewUrl: string }|null} site
     * @returns {Promise<string|null>} active proxy base URL
     */
    async activateSite(siteId, site) {
      if (!siteId || !site) {
        activeSiteId = null;
        activeUpstreamOrigin = null;
        activeBaseUrl = null;
        return null;
      }

      const upstreamOrigin = previewUrlOrigin(site.previewUrl);
      const sameSite = activeSiteId === siteId;
      const sameOrigin = activeUpstreamOrigin === upstreamOrigin;

      if (sameSite) {
        return activeBaseUrl;
      }

      activeSiteId = siteId;
      const entry = await ensureServer(upstreamOrigin);
      activeUpstreamOrigin = upstreamOrigin;
      activeBaseUrl = entry.baseUrl;

      if (!sameOrigin) {
        entry.headHtmlCache.clear();
      }

      return activeBaseUrl;
    },

    /** @returns {string|null} */
    getBaseUrl() {
      return activeBaseUrl;
    },

    /** @returns {string|null} */
    getActiveUpstreamOrigin() {
      return activeUpstreamOrigin;
    },

    async closeAll() {
      const closes = [...serversByOrigin.values()].map((entry) => entry.close());
      await Promise.allSettled(closes);
      serversByOrigin.clear();
      activeSiteId = null;
      activeUpstreamOrigin = null;
      activeBaseUrl = null;
    },
  };
}
