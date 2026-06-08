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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { togglePathsCheckState } from '../src/renderer/review-view.js';

describe('togglePathsCheckState', () => {
  it('checks all paths when any selected path is unchecked', () => {
    const next = togglePathsCheckState(new Set(['a']), ['a', 'b', 'c']);
    assert.deepEqual([...next].sort(), ['a', 'b', 'c']);
  });

  it('unchecks all paths when every selected path is checked', () => {
    const next = togglePathsCheckState(new Set(['a', 'b', 'c']), ['a', 'b', 'c']);
    assert.equal(next.size, 0);
  });

  it('checks partial selection when not all targets are checked', () => {
    const next = togglePathsCheckState(new Set(['a', 'b']), ['a', 'b', 'c']);
    assert.deepEqual([...next].sort(), ['a', 'b', 'c']);
  });
});
