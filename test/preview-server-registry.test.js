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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPreviewServerRegistry,
  previewUrlOrigin,
} from '../src/main/preview-server-registry.js';

test('previewUrlOrigin extracts origin from preview URL', () => {
  assert.equal(
    previewUrlOrigin('https://main--id--org.aem.page/path'),
    'https://main--id--org.aem.page',
  );
});

test('preview server registry assigns ports per upstream origin', async () => {
  let nextPort = 5000;

  const registry = createPreviewServerRegistry({
    startPreviewServer: async () => {
      nextPort += 1;
      return {
        baseUrl: `http://127.0.0.1:${nextPort}`,
        close: async () => {},
      };
    },
    createHeadHtmlCache: () => ({
      clear: () => {},
      resolve: async () => '',
    }),
    createMetadataJsonCache: () => ({
      clear: () => {},
      resolveSheetRow: async () => null,
    }),
    getSyncFolder: async () => null,
    getToken: async () => null,
    resolveActiveSite: async (siteId) => ({
      org: 'org',
      repo: siteId,
      previewUrl: `https://main--${siteId}--org.aem.page`,
    }),
  });

  const siteA = {
    org: 'org',
    repo: 'a',
    previewUrl: 'https://main--a--org.aem.page',
  };
  const siteB = {
    org: 'org',
    repo: 'b',
    previewUrl: 'https://main--b--org.aem.page',
  };

  const first = await registry.activateSite('a', siteA);
  const second = await registry.activateSite('b', siteB);
  const backToA = await registry.activateSite('a', siteA);

  assert.notEqual(first, second, 'different upstream origins should get different ports');
  assert.equal(backToA, first, 'returning to a prior origin should reuse its port');
  assert.equal(registry.getActiveUpstreamOrigin(), previewUrlOrigin(siteA.previewUrl));
});

test('preview server registry clears active base URL when deactivated', async () => {
  const registry = createPreviewServerRegistry({
    startPreviewServer: async () => ({
      baseUrl: 'http://127.0.0.1:6001',
      close: async () => {},
    }),
    createHeadHtmlCache: () => ({
      clear: () => {},
      resolve: async () => '',
    }),
    createMetadataJsonCache: () => ({
      clear: () => {},
      resolveSheetRow: async () => null,
    }),
    getSyncFolder: async () => null,
    getToken: async () => null,
    resolveActiveSite: async () => null,
  });

  await registry.activateSite('a', {
    org: 'org',
    repo: 'a',
    previewUrl: 'https://main--a--org.aem.page',
  });
  assert.equal(registry.getBaseUrl(), 'http://127.0.0.1:6001');

  await registry.activateSite(null, null);
  assert.equal(registry.getBaseUrl(), null);
  assert.equal(registry.getActiveUpstreamOrigin(), null);
});

test('preview server registry clearHeadCache clears cached head for one origin', async () => {
  let cleared = 0;
  const registry = createPreviewServerRegistry({
    startPreviewServer: async () => ({
      baseUrl: 'http://127.0.0.1:6002',
      close: async () => {},
    }),
    createHeadHtmlCache: () => ({
      clear: () => { cleared += 1; },
      resolve: async () => '',
    }),
    createMetadataJsonCache: () => ({
      clear: () => { cleared += 1; },
      resolveSheetRow: async () => null,
    }),
    getSyncFolder: async () => null,
    getToken: async () => null,
    resolveActiveSite: async () => null,
  });

  await registry.activateSite('a', {
    org: 'org',
    repo: 'a',
    previewUrl: 'https://main--a--org.aem.page',
  });
  cleared = 0;
  registry.clearHeadCache('https://main--a--org.aem.page');
  assert.equal(cleared, 2);
});
