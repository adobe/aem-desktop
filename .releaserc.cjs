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
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md',
    }],
    // Bump the version in package.json without publishing to npm; the
    // artifact build below reads this version via extraMetadata.
    ['@semantic-release/npm', {
      npmPublish: false,
    }],
    // Build, sign and notarize the macOS DMG + auto-update artifacts.
    // --publish never keeps electron-builder from creating its own GitHub
    // release; the @semantic-release/github step attaches the artifacts to
    // the release semantic-release creates, which electron-updater reads.
    ['@semantic-release/exec', {
      prepareCmd: 'npx electron-builder --mac --publish never -c.extraMetadata.version=${nextRelease.version}',
    }],
    ['@semantic-release/github', {
      assets: [
        { path: 'dist/*.dmg', label: 'macOS Disk Image' },
        { path: 'dist/*.dmg.blockmap' },
        { path: 'dist/*.zip' },
        { path: 'dist/*.zip.blockmap' },
        { path: 'dist/latest-mac.yml' },
      ],
    }],
    ['@semantic-release/git', {
      assets: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    }],
  ],
};
