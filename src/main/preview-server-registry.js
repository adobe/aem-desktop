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
 *   createMetadataJsonCache: typeof import('./metadata-json.js').createMetadataJsonCache,
 *   getSyncFolder: () => Promise<string|null>,
 *   resolveActiveSite: (siteId: string) => Promise<{
 *     org: string,
 *     repo: string,
 *     branch?: string,
 *     previewUrl: string,
 *     apiBackend?: string,
 *   }|null>,
 *   getSiteToken: (org: string, repo: string) => Promise<string|null>,
 *   saveSiteToken: (org: string, repo: string, siteToken: string) => Promise<void>,
 *   onSiteTokenSaved?: (payload: { org: string, repo: string, siteToken: string }) => void,
 *   log?: import('electron-log').MainLogger,
 * }} deps
 */
export function createPreviewServerRegistry(deps) {
  /** @type {Map<string, {
   *   baseUrl: string,
   *   close: () => Promise<void>,
   *   headHtmlCache: ReturnType<typeof deps.createHeadHtmlCache>,
   *   metadataJsonCache: ReturnType<typeof deps.createMetadataJsonCache>,
   *   loginSession: ReturnType<import('./site-auth.js').createSiteLoginSession>,
   *   activeOrg: string|null,
   *   activeRepo: string|null,
   * }>} */
  const serversByOrigin = new Map();

  let activeSiteId = null;
  let activeUpstreamOrigin = null;
  let activeBaseUrl = null;
  /** @type {{ org: string, repo: string }|null} */
  let activeSiteIdentity = null;

  async function ensureServer(upstreamOrigin) {
    const existing = serversByOrigin.get(upstreamOrigin);
    if (existing) {
      return existing;
    }

    const headHtmlCache = deps.createHeadHtmlCache();
    const metadataJsonCache = deps.createMetadataJsonCache();
    /** @type {{ org: string, repo: string }|null} */
    let serverSiteIdentity = null;

    const server = await deps.startPreviewServer({
      log: deps.log,
      headHtmlCache,
      metadataJsonCache,
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
        serverSiteIdentity = { org: site.org, repo: site.repo };
        return site;
      },
      getSyncFolder: deps.getSyncFolder,
      getSiteToken: async () => {
        if (!serverSiteIdentity) {
          return null;
        }
        return deps.getSiteToken(serverSiteIdentity.org, serverSiteIdentity.repo);
      },
      onSiteToken: async (siteToken) => {
        if (!serverSiteIdentity) {
          throw new Error('No active site for site token');
        }
        await deps.saveSiteToken(
          serverSiteIdentity.org,
          serverSiteIdentity.repo,
          siteToken,
        );
        headHtmlCache.clear();
        metadataJsonCache.clear();
        deps.onSiteTokenSaved?.({
          org: serverSiteIdentity.org,
          repo: serverSiteIdentity.repo,
          siteToken,
        });
      },
    });

    const entry = {
      baseUrl: server.baseUrl,
      close: server.close,
      headHtmlCache,
      metadataJsonCache,
      loginSession: server.loginSession,
      activeOrg: null,
      activeRepo: null,
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
     * @param {{
     *   org: string,
     *   repo: string,
     *   branch?: string,
     *   previewUrl: string,
     *   apiBackend?: string,
     * }|null} site
     * @returns {Promise<string|null>} active proxy base URL
     */
    async activateSite(siteId, site) {
      if (!siteId || !site) {
        activeSiteId = null;
        activeUpstreamOrigin = null;
        activeBaseUrl = null;
        activeSiteIdentity = null;
        return null;
      }

      const upstreamOrigin = previewUrlOrigin(site.previewUrl);
      const sameSite = activeSiteId === siteId;
      const sameOrigin = activeUpstreamOrigin === upstreamOrigin;

      if (sameSite) {
        return activeBaseUrl;
      }

      activeSiteId = siteId;
      activeSiteIdentity = { org: site.org, repo: site.repo };
      const entry = await ensureServer(upstreamOrigin);
      entry.activeOrg = site.org;
      entry.activeRepo = site.repo;
      activeUpstreamOrigin = upstreamOrigin;
      activeBaseUrl = entry.baseUrl;

      if (!sameOrigin) {
        entry.headHtmlCache.clear();
        entry.metadataJsonCache.clear();
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

    /** @returns {{ org: string, repo: string }|null} */
    getActiveSiteIdentity() {
      return activeSiteIdentity;
    },

    async closeAll() {
      const closes = [...serversByOrigin.values()].map((entry) => entry.close());
      await Promise.allSettled(closes);
      serversByOrigin.clear();
      activeSiteId = null;
      activeUpstreamOrigin = null;
      activeBaseUrl = null;
      activeSiteIdentity = null;
    },
  };
}
