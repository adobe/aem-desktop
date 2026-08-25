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
import {
  chmod, mkdir, readdir, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

// The `.aem` folder holds pristine server copies the app diffs and reverts
// against. Nothing in here is meant to be hand-edited — so we (a) mark the
// originals read-only and (b) drop a README + .gitignore to discourage tools
// (and AIs) from wandering in and corrupting the baseline. These are cheap
// deterrents, not a security boundary: they stop accidents, not intent.

/** Mode for a pristine original: read-only for owner/group/other. */
export const READONLY_MODE = 0o444;

/** Mode restoring owner write so the app can rewrite/replace an original. */
export const WRITABLE_MODE = 0o644;

const README_CONTENT = `AEM Desktop — managed files. DO NOT EDIT.

This folder holds pristine copies of the content AEM Desktop downloaded from the
server. The app compares against these originals to detect and revert your local
changes, so editing, renaming, or deleting anything here corrupts change
detection — your edits may be silently lost or falsely reported as conflicts.

To change content, edit the working copies in the parent folder instead, then
use the app's Upload action. The files here are intentionally read-only.
`;

// `*` ignores the entire folder (including this file) from any surrounding git
// repo, without touching the user's own .gitignore in the working copy.
const GITIGNORE_CONTENT = '*\n';

/**
 * The guard files written into every `.aem` directory. Pure so it can be
 * asserted in tests without touching the filesystem.
 *
 * @returns {Array<{ name: string, content: string }>}
 */
export function aemGuardFiles() {
  return [
    { name: 'README.txt', content: README_CONTENT },
    { name: '.gitignore', content: GITIGNORE_CONTENT },
  ];
}

/**
 * Best-effort: mark a pristine original read-only. Never throws — the read-only
 * bit is a nicety, and some filesystems (network shares, FAT) ignore chmod.
 *
 * @param {string} filePath
 */
export async function makeReadOnly(filePath) {
  try {
    await chmod(filePath, READONLY_MODE);
  } catch { /* best effort */ }
}

/**
 * Best-effort: restore owner write so the app can overwrite or delete an
 * original it previously marked read-only. Swallows the missing-file case (a
 * brand-new original) and any chmod rejection; a genuine permission problem
 * surfaces on the subsequent write instead.
 *
 * @param {string} filePath
 */
export async function makeWritable(filePath) {
  try {
    await chmod(filePath, WRITABLE_MODE);
  } catch { /* best effort */ }
}

/**
 * Best-effort: recursively restore owner write across a directory tree so a
 * subsequent recursive delete isn't blocked by our read-only originals (on
 * Windows a read-only file can't be unlinked). Missing tree → no-op.
 *
 * @param {string} dir
 */
export async function restoreTreeWritable(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // missing or unreadable — nothing to unlock
  }
  await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await restoreTreeWritable(full);
    } else {
      await makeWritable(full);
    }
  }));
}

/**
 * Writes (idempotently) the README + .gitignore deterrents into an `.aem`
 * directory. Best-effort: failure here must never abort a sync.
 *
 * @param {string} aemDir absolute path to the `.aem` directory
 */
export async function writeAemGuardFiles(aemDir) {
  try {
    await mkdir(aemDir, { recursive: true });
    await Promise.all(aemGuardFiles().map(
      ({ name, content }) => writeFile(join(aemDir, name), content, 'utf8'),
    ));
  } catch { /* best effort */ }
}
