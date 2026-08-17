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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import log from 'electron-log/node.js';
import { resolveCdpPort } from '../src/main/dev-config.js';

const require = createRequire(import.meta.url);
// The `electron` package exports the absolute path to its binary in Node.
const electronBinary = require('electron');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Launch with Chrome DevTools Protocol enabled so agents/tools can attach.
const cdpPort = resolveCdpPort(process.env);
const electronArgs = ['.', `--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*'];

// No file watching: use Cmd/Ctrl+R in the app to reload the renderer; restart
// this command to pick up main/preload changes. (Auto-reload was removed because
// respawning Electron on every save stole editor focus.)
log.info(`[dev] launching Electron (CDP http://localhost:${cdpPort}) — Cmd+R reloads; restart for main/preload changes`);
const child = spawn(electronBinary, electronArgs, { cwd: root, stdio: 'inherit' });

child.on('exit', (code) => {
  if (code !== null) {
    process.exit(code);
  }
});

process.on('SIGINT', () => {
  child.kill();
  process.exit(0);
});
