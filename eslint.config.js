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
import { defineConfig, globalIgnores } from '@eslint/config-helpers';
import { recommended, source, test } from '@adobe/eslint-config-helix';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    'dist/*',
    'out/*',
    'coverage/*',
    'node_modules/*',
  ]),
  {
    extends: [recommended],
  },
  source,
  test,
  {
    // Main and preload run in the Electron/Node main process. `electron` is a
    // devDependency by design (electron-builder bundles it; it must not be a
    // runtime npm dependency), so allow importing it here.
    files: ['src/main/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      // Main/dev scripts log to the terminal (forwarded to `npm run dev`).
      'no-console': 'off',
    },
  },
  {
    // Preload bridges run sandboxed and must be CommonJS.
    files: ['src/preload/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
  {
    // Renderer code runs in the Chromium browser context.
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Renderer console output is forwarded to the dev terminal.
      'no-console': 'off',
    },
  },
]);
