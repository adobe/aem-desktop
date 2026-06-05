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
import log from 'electron-log';

// Single shared logger for the main process. electron-log writes to the OS log
// directory and to the console; `error`/`warn` go to stderr, everything else to
// stdout. Prefer this over `console.log` so output is timestamped, scoped, and
// persisted to a file. `initialize()` wires the renderer bridge for future use.
log.initialize?.();

export default log;
