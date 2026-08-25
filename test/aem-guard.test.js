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
  mkdtemp, mkdir, writeFile, readFile, stat, chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  READONLY_MODE,
  WRITABLE_MODE,
  aemGuardFiles,
  makeReadOnly,
  makeWritable,
  restoreTreeWritable,
  writeAemGuardFiles,
} from '../src/main/aem-guard.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'aem-guard-'));
}

// chmod on the owner-write bit is what we assert; take the low 9 permission
// bits (mode % 0o1000) to ignore the platform's file-type bits, without the
// bitwise-and the lint config forbids.
function mode(stats) {
  return stats.mode % 0o1000;
}

test('aemGuardFiles returns a README and a catch-all .gitignore', () => {
  const files = aemGuardFiles();
  const byName = new Map(files.map((f) => [f.name, f.content]));
  assert.ok(byName.has('README.txt'));
  assert.match(byName.get('README.txt'), /DO NOT EDIT/);
  assert.equal(byName.get('.gitignore'), '*\n');
});

test('makeReadOnly then makeWritable toggle the owner write bit', async () => {
  const dir = await tmp();
  const file = join(dir, 'original.html');
  await writeFile(file, 'hi', 'utf8');

  await makeReadOnly(file);
  assert.equal(mode(await stat(file)), READONLY_MODE);

  await makeWritable(file);
  assert.equal(mode(await stat(file)), WRITABLE_MODE);
});

test('makeReadOnly / makeWritable never throw on a missing path', async () => {
  const dir = await tmp();
  await assert.doesNotReject(makeReadOnly(join(dir, 'nope')));
  await assert.doesNotReject(makeWritable(join(dir, 'nope')));
});

test('writeAemGuardFiles creates the deterrent files (idempotently)', async () => {
  const dir = await tmp();
  const aem = join(dir, '.aem');

  await writeAemGuardFiles(aem);
  await writeAemGuardFiles(aem); // second call must not throw

  assert.match(await readFile(join(aem, 'README.txt'), 'utf8'), /DO NOT EDIT/);
  assert.equal(await readFile(join(aem, '.gitignore'), 'utf8'), '*\n');
});

test('restoreTreeWritable clears read-only across nested files', async () => {
  const dir = await tmp();
  const nested = join(dir, 'a', 'b');
  await mkdir(nested, { recursive: true });
  const f1 = join(dir, 'a', 'one.html');
  const f2 = join(nested, 'two.json');
  await writeFile(f1, '1', 'utf8');
  await writeFile(f2, '2', 'utf8');
  await chmod(f1, READONLY_MODE);
  await chmod(f2, READONLY_MODE);

  await restoreTreeWritable(dir);

  assert.equal(mode(await stat(f1)), WRITABLE_MODE);
  assert.equal(mode(await stat(f2)), WRITABLE_MODE);
});

test('restoreTreeWritable is a no-op on a missing directory', async () => {
  const dir = await tmp();
  await assert.doesNotReject(restoreTreeWritable(join(dir, 'missing')));
});
