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
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import {
  shellQuote, buildLauncherScript, buildWindowsLauncher, isOnPath, installCli,
} from '../src/main/cli-install.js';

test('shellQuote escapes quotes, backslashes, $ and backticks', () => {
  assert.equal(shellQuote('/Applications/AEM Desktop.app'), '"/Applications/AEM Desktop.app"');
  assert.equal(shellQuote('a"b$c`d\\e'), '"a\\"b\\$c\\`d\\\\e"');
});

test('buildLauncherScript sets env and execs the binary with the entry', () => {
  const script = buildLauncherScript({
    execPath: '/Applications/AEM Desktop.app/Contents/MacOS/AEM Desktop',
    cliEntry: '/opt/app/src/cli/content.js',
    userData: '/Users/x/Library/Application Support/AEM Desktop',
  });
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(script, /AEM_DESKTOP_USER_DATA="\/Users\/x\/Library\/Application Support\/AEM Desktop"/);
  assert.match(script, /exec env .* "\$@"\n$/);
});

test('buildWindowsLauncher emits a .cmd with CRLF and %*', () => {
  const script = buildWindowsLauncher({
    execPath: 'C:\\Apps\\AEM Desktop\\AEM Desktop.exe',
    cliEntry: 'C:\\Apps\\AEM Desktop\\resources\\app.asar.unpacked\\src\\cli\\content.js',
    userData: 'C:\\Users\\x\\AppData\\Roaming\\AEM Desktop',
  });
  assert.match(script, /@echo off\r\n/);
  assert.match(script, /set "ELECTRON_RUN_AS_NODE=1"/);
  assert.ok(script.endsWith('%*\r\n'));
});

test('isOnPath matches ignoring trailing slashes', () => {
  assert.equal(isOnPath('/usr/local/bin', '/bin:/usr/local/bin:/sbin'), true);
  assert.equal(isOnPath('/usr/local/bin/', '/usr/local/bin'), true);
  assert.equal(isOnPath('/opt/bin', '/usr/local/bin'), false);
  assert.equal(isOnPath('/opt/bin', undefined), false);
});

test('installCli writes an executable POSIX launcher and reports PATH status', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-install-'));
  try {
    const result = await installCli({
      execPath: '/opt/electron',
      cliEntry: '/opt/app/src/cli/content.js',
      userData: '/data',
      platform: 'linux',
      home,
      pathEnv: `/usr/bin:${join(home, '.local', 'bin')}`,
    });
    assert.equal(result.path, join(home, '.local', 'bin', 'content'));
    assert.equal(result.onPath, true);
    const body = await readFile(result.path, 'utf8');
    assert.match(body, /content\.js/);
    const perms = ((await stat(result.path)).mode % 0o1000).toString(8).padStart(3, '0');
    assert.equal(perms, '755', 'launcher is rwxr-xr-x');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('installCli on win32 writes content.cmd', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cli-install-win-'));
  try {
    const result = await installCli({
      execPath: 'C:\\app\\AEM.exe',
      cliEntry: 'C:\\app\\content.js',
      userData: 'C:\\data',
      platform: 'win32',
      home,
      pathEnv: '',
    });
    assert.ok(result.path.endsWith('content.cmd'));
    assert.equal(result.onPath, false);
    const body = await readFile(result.path, 'utf8');
    assert.match(body, /%\*/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
