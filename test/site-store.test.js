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
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addSiteFromUrl, loadSites, removeSite, saveSites,
  API_BACKEND_AEM_API,
} from '../src/main/site-store.js';

test('addSiteFromUrl persists and deduplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aem-desktop-sites-'));
  const storePath = join(dir, 'sites.json');

  try {
    const { site, sites } = addSiteFromUrl([], 'https://main--id--davidnuescheler.aem.page/');
    assert.equal(site.org, 'davidnuescheler');
    assert.equal(site.repo, 'id');
    assert.equal(sites.length, 1);

    await saveSites(storePath, sites);
    const loaded = await loadSites(storePath);
    assert.equal(loaded.length, 1);

    assert.throws(
      () => addSiteFromUrl(loaded, 'https://main--id--davidnuescheler.aem.page/'),
      /already added/,
    );

    const { site: apiSite } = addSiteFromUrl(
      [],
      'https://main--other--davidnuescheler.aem.page/',
      API_BACKEND_AEM_API,
    );
    assert.equal(apiSite.apiBackend, API_BACKEND_AEM_API);

    const next = removeSite(loaded, site.id);
    assert.equal(next.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
