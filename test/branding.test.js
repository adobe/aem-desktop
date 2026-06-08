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
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('productName drives the macOS app/menu name (not the package name)', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.productName, 'AEM Desktop');
});

test('app icon is present for electron-builder', () => {
  const icns = statSync(join(root, 'build', 'icon.icns'));
  assert.ok(icns.size > 0, 'build/icon.icns must exist and be non-empty');
});

test('renderer logo is present', () => {
  const logo = statSync(join(root, 'src', 'renderer', 'logo.png'));
  assert.ok(logo.size > 0, 'src/renderer/logo.png must exist and be non-empty');
});

test('Adobe Clean fonts are bundled with the renderer', () => {
  for (const weight of ['Regular', 'Medium', 'Bold']) {
    const file = join(root, 'src', 'renderer', 'fonts', `AdobeClean-${weight}.otf`);
    assert.ok(statSync(file).size > 0, `${file} must exist`);
  }
});

test('S2 file-type icons are bundled with the renderer', () => {
  for (const icon of [
    'S2_Icon_Folder_20_N.svg',
    'S2_Icon_FileText_20_N.svg',
    'S2_Icon_Image_20_N.svg',
    'S2_Icon_Table_20_N.svg',
  ]) {
    const file = join(root, 'src', 'renderer', 'icons', icon);
    assert.ok(statSync(file).size > 0, `${file} must exist`);
  }
});

test('S2 design tokens and file-tree styles are bundled', () => {
  for (const file of ['s2-tokens.css', 'file-tree.css']) {
    const path = join(root, 'src', 'renderer', file);
    assert.ok(statSync(path).size > 0, `${path} must exist`);
  }
});
