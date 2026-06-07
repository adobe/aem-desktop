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
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { select } from 'hast-util-select';

const REHYPE_FRAGMENT = { fragment: true };

/**
 * @param {import('hast').Root} tree
 * @returns {string}
 */
export function hashHeadTree(tree) {
  const h = createHash('sha1');

  const update = (obj, keys) => {
    keys.sort();
    for (const k of keys) {
      if (k === 'nonce') {
        // eslint-disable-next-line no-continue
        continue;
      }
      let v = obj[k];
      if (v !== undefined) {
        if (Array.isArray(v)) {
          v = JSON.stringify(v);
        }
        h.update(String(v));
      }
    }
  };

  update(tree, ['type', 'tagName', 'value']);
  if (tree.properties) {
    update(tree.properties, Object.keys(tree.properties));
  }

  if (tree.children) {
    for (let i = 0; i < tree.children.length; i += 1) {
      const child = tree.children[i];
      if (child.type === 'text' && child.value.trim() === '') {
        tree.children.splice(i, 1);
        i -= 1;
      } else {
        h.update(hashHeadTree(child));
      }
    }
  }

  // eslint-disable-next-line no-param-reassign
  tree.hash = h.digest('base64');
  return tree.hash;
}

/**
 * @param {string} html
 * @returns {Promise<import('hast').Root>}
 */
export async function parseHeadFragment(html) {
  return unified()
    .use(rehypeParse, REHYPE_FRAGMENT)
    .parse(html);
}

/**
 * @param {string} syncRootDir
 * @returns {Promise<string>}
 */
export async function readLocalHeadHtml(syncRootDir) {
  const filePath = join(syncRootDir, 'head.html');
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return '';
    }
    return (await readFile(filePath, 'utf-8')).trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} previewUrlOrigin
 * @param {Map<string, { html: string, dom: import('hast').Root|null }>} cache
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{ html: string, dom: import('hast').Root|null }>}
 */
export async function fetchRemoteHeadHtml(previewUrlOrigin, cache, fetchFn = fetch) {
  const origin = previewUrlOrigin.replace(/\/+$/, '');
  const cached = cache.get(origin);
  if (cached) {
    return cached;
  }

  const url = `${origin}/head.html`;
  let entry = { html: '', dom: null };
  try {
    const resp = await fetchFn(url, { cache: 'no-store' });
    if (resp.ok) {
      const html = (await resp.text()).trim();
      const dom = await parseHeadFragment(html);
      hashHeadTree(dom);
      entry = { html, dom };
    }
  } catch {
    // leave empty entry
  }

  cache.set(origin, entry);
  return entry;
}

/**
 * Replaces the remote head block with local head.html when modified locally.
 *
 * @param {string} source
 * @param {string} localHtml
 * @param {import('hast').Root|null} remoteDom
 * @returns {Promise<string>}
 */
export async function replaceHeadInDocument(source, localHtml, remoteDom) {
  if (!localHtml) {
    return source;
  }

  const $html = unified().use(rehypeParse).parse(source);
  const $head = select('head', $html);
  if (!$head) {
    return source;
  }

  const $dst = remoteDom;
  if (!$dst) {
    const $last = $head.children[$head.children.length - 1];
    const to = $last.position.end.offset;
    return `${source.substring(0, to)}${localHtml}${source.substring(to)}`;
  }

  hashHeadTree($head);
  const srcLen = $head.children.length;
  const dstLen = $dst.children.length;

  let $first;
  let $last;
  for (let s = 0; !$last && s <= srcLen - dstLen; s += 1) {
    $first = $head.children[s];
    for (let d = 0; d < dstLen; d += 1) {
      $last = $head.children[s + d];
      if ($last.hash !== $dst.children[d].hash) {
        $last = null;
        break;
      }
    }
  }

  if (!$last) {
    return source;
  }

  const from = $first.position.start.offset;
  const to = $last.position.end.offset;
  return `${source.substring(0, from)}${localHtml}${source.substring(to)}`;
}

/**
 * @typedef {{
 *   headFragment: string,
 *   localHtml: string,
 *   remoteDom: import('hast').Root|null,
 *   isModified: boolean,
 * }} ResolvedHeadHtml
 */

/**
 * @param {{
 *   previewUrlOrigin: string,
 *   syncRootDir: string,
 *   cache: Map<string, { html: string, dom: import('hast').Root|null }>,
 *   fetchFn?: typeof fetch,
 * }} options
 * @returns {Promise<ResolvedHeadHtml>}
 */
export async function resolveHeadHtml({
  previewUrlOrigin, syncRootDir, cache, fetchFn = fetch,
}) {
  const localHtml = await readLocalHeadHtml(syncRootDir);
  const remote = await fetchRemoteHeadHtml(previewUrlOrigin, cache, fetchFn);
  const isModified = Boolean(localHtml && remote.html && localHtml !== remote.html);

  let headFragment = '';
  if (localHtml) {
    headFragment = localHtml;
  } else {
    headFragment = remote.html;
  }

  return {
    headFragment,
    localHtml,
    remoteDom: remote.dom,
    isModified,
  };
}

/**
 * @returns {{
 *   cache: Map<string, { html: string, dom: import('hast').Root|null }>,
 *   resolve: typeof resolveHeadHtml,
 *   clear: (previewUrlOrigin?: string) => void,
 * }}
 */
export function createHeadHtmlCache() {
  /** @type {Map<string, { html: string, dom: import('hast').Root|null }>} */
  const cache = new Map();

  return {
    cache,
    resolve: (options) => resolveHeadHtml({ ...options, cache }),
    clear(previewUrlOrigin) {
      if (previewUrlOrigin) {
        cache.delete(previewUrlOrigin.replace(/\/+$/, ''));
        return;
      }
      cache.clear();
    },
  };
}
