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
import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { transformContentMetadataHtml } from './content-metadata-html.js';
import { replaceHeadInDocument } from './head-html.js';
import { previewPathToLocalRelativePaths } from './preview-url.js';

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function contentTypeForRelativePath(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'text/html; charset=utf-8';
  }
  if (lower.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (lower.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (lower.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

/**
 * Resolves a preview URL path to a local sync file when present.
 *
 * @param {string} syncRootDir
 * @param {string} previewPath
 * @returns {Promise<{ filePath: string, relativePath: string }|null>}
 */
export async function resolveLocalContentFile(syncRootDir, previewPath) {
  const candidates = previewPathToLocalRelativePaths(previewPath);
  for (let i = 0; i < candidates.length; i += 1) {
    const rel = candidates[i];
    const filePath = join(syncRootDir, rel);
    if (relative(syncRootDir, filePath).startsWith('..')) {
      // eslint-disable-next-line no-continue
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        return { filePath, relativePath: rel };
      }
    } catch {
      // not found
    }
  }
  return null;
}

/**
 * Applies helix-cli-style metadata + head.html wrapping for local content HTML.
 *
 * @param {string} htmlContent
 * @param {string} absolutePageUrl
 * @param {import('./head-html.js').ResolvedHeadHtml} headHtml
 * @returns {Promise<string>}
 */
export async function prepareLocalHtml(htmlContent, absolutePageUrl, headHtml) {
  const { htmlFragment, metaTagsHtml } = transformContentMetadataHtml(htmlContent, {
    absolutePageUrl,
  });
  let html = htmlFragment;

  if (!html.includes('<head>')) {
    html = `<html><head>${headHtml.headFragment}${metaTagsHtml}</head>${html}</html>`;
    return html;
  }

  if (headHtml.isModified) {
    html = await replaceHeadInDocument(html, headHtml.localHtml, headHtml.remoteDom);
  }
  if (metaTagsHtml) {
    html = html.replace(/<\/head>/i, `${metaTagsHtml}</head>`);
  }
  return html;
}

/**
 * @param {string} filePath
 * @param {string} relativePath
 * @param {string} absolutePageUrl
 * @param {import('./head-html.js').ResolvedHeadHtml} headHtml
 * @returns {Promise<{ body: string|Buffer, contentType: string }>}
 */
export async function readLocalPreviewContent(
  filePath,
  relativePath,
  absolutePageUrl,
  headHtml,
) {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const raw = await readFile(filePath, 'utf-8');
    return {
      body: await prepareLocalHtml(raw, absolutePageUrl, headHtml),
      contentType: 'text/html; charset=utf-8',
    };
  }
  if (lower.endsWith('.json')) {
    return {
      body: await readFile(filePath, 'utf-8'),
      contentType: 'application/json; charset=utf-8',
    };
  }
  return {
    body: await readFile(filePath),
    contentType: contentTypeForRelativePath(relativePath),
  };
}
