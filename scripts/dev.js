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
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The `electron` package exports the absolute path to its binary in Node.
const electronBinary = require('electron');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Main + preload run out of process, so changes require a full Electron restart.
// Renderer changes are hot-reloaded in-process by src/main/dev-reload.js.
const watchDirs = [join(root, 'src', 'main'), join(root, 'src', 'preload')];

let child;
let restarting;

function start() {
  child = spawn(electronBinary, ['.'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (!restarting && code !== null) {
      process.exit(code);
    }
  });
}

function restart() {
  clearTimeout(restarting);
  restarting = setTimeout(() => {
    restarting = undefined;
    if (child) {
      child.removeAllListeners('exit');
      child.kill();
    }
    // eslint-disable-next-line no-console
    console.log('[dev] restarting Electron (main/preload changed)');
    start();
  }, 150);
}

for (const dir of watchDirs) {
  watch(dir, { recursive: true }, restart);
}

process.on('SIGINT', () => {
  child?.kill();
  process.exit(0);
});

start();
