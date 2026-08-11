# CLAUDE.md

Navigation hub and working agreement for the **AEM Desktop** app — a desktop
shell for Adobe Experience Manager Edge Delivery Services. This file is the
first thing to read before making changes.

> `AGENTS.md` is a symlink to this file.

## What this is

An [Electron](https://www.electronjs.org/) desktop application. Today it is an
**empty shell** (window + version readout); the point of this repository is the
*development environment around it*: hot reload, auto-update, and a signed,
notarized release pipeline so feature work can start on a solid foundation.

Deliberate stack choices (kept close to `@adobe/aem-cli` / helix-cli, not slicc):

- **Pure ESM JavaScript** — no TypeScript, no bundler. The renderer is plain
  ESM over `file://`; the main process is ESM run directly by Electron.
- **No Vite / webpack.** Hot reload is bundler-free (see below).
- **`node --test`** for unit and integration tests (no Mocha/Vitest).
- **ESLint** with `@adobe/eslint-config-helix` (Apache headers enforced). No Prettier.
- **electron-builder** for packaging/signing/notarization, **electron-updater**
  for in-app updates, **semantic-release** to drive versioning and releases.

## Module map

| Path                          | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `src/main/index.js`           | App entry: lifecycle, `BrowserWindow`, IPC, wires updater + dev reload   |
| `src/main/window-options.js`  | Pure builder of secure `BrowserWindow` options (unit tested)             |
| `src/main/update-policy.js`   | Pure `shouldAutoUpdate()` decision (unit tested)                         |
| `src/main/updater.js`         | electron-updater wiring against the GitHub release feed                  |
| `src/main/logger.js`          | Shared `electron-log` logger (use instead of `console.log`)              |
| `src/main/dev-config.js`      | Pure dev helpers: CDP port + screenshot filename (unit tested)           |
| `src/main/dev-reload.js`      | Renderer live-reload + console forwarding (dev only)                     |
| `src/main/cli-install.js`     | Installs the `content` CLI launcher on PATH (pure builders unit tested)  |
| `src/preload/index.cjs`       | Sandboxed `contextBridge` API — **the only CommonJS file** (see note)    |
| `src/renderer/`               | `index.html` + `renderer.js` + `styles.css` — the UI shell              |
| `src/cli/content.js`          | The `content` CLI entry (sites/download/update/upload); Node-only        |
| `src/cli/cli-lib.js`          | Pure CLI arg parser + site selector (unit tested)                        |
| `scripts/dev.js`              | Dev launcher: runs Electron, restarts on main/preload change            |
| `test/`                       | `node --test` unit + config integration tests                           |
| `build/`                      | electron-builder resources (entitlements; add icons here)               |
| `electron-builder.yml`        | Packaging, signing, notarization, DMG layout, GitHub publish target     |
| `.releaserc.cjs`              | semantic-release plugin chain (build → attach artifacts → tag)           |
| `.github/workflows/`          | `main.yaml` (lint/test/build smoke on mac+win), `release.yaml` (mac+win release) |

## Commands

```bash
npm install        # first-time setup (downloads the Electron binary)
npm run dev        # run with hot reload (recommended for development)
npm start          # run the app once, no watchers
npm run lint       # ESLint (Adobe config; enforces Apache headers)
npm run lint:fix   # autofix lint issues
npm test           # node --test (unit + config integration)
npm run build      # signed/notarized DMG+ZIP locally (needs Apple env vars)
npm run build:dir  # unpacked .app for quick local inspection (no signing)
```

## Architecture & security

The window is created with hardened defaults in `window-options.js`:
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The
renderer therefore has **no Node access** — everything crosses the
`contextBridge` in `src/preload/index.cjs`, exposed as `window.aemDesktop`.

> **Why is the preload CommonJS?** Sandboxed preload scripts cannot use ESM
> `import`. `index.cjs` is intentionally the single non-ESM module. Keep the
> bridge surface minimal; add new IPC channels as `ipcMain.handle()` in
> `index.js` and a matching `ipcRenderer.invoke()` wrapper in the preload.

A strict `Content-Security-Policy` is set in `index.html`. External links are
forced into the system browser via `setWindowOpenHandler`.

## Command-line interface (`content`)

The app ships a companion CLI, `content`, exposing the most common operations
(`sites`, `status`, `download`, `update`, `upload`). It lives in `src/cli/` and
imports the same Node-safe core modules the main process uses (`da-sync.js`,
`content-api-client.js`, the stores, `da-session.js`) — it never touches an
Electron API, so it runs under plain Node **or** the bundled Electron binary in
Node mode.

- **Shared state.** The CLI reads the app's `sites.json`, `sync-folder.json`,
  `.da-token.json`, and `.site-tokens.json` from the app's user-data directory.
  It finds that directory via the `AEM_DESKTOP_USER_DATA` env var (set by the
  installed launcher), falling back to Electron's default per-platform path. So
  the CLI shares the desktop app's connections and sign-in; interactive login
  still happens in the app (it needs a `BrowserWindow`).
- **Install.** The **Install CLI** button on the home screen calls the
  `cli:install` IPC handler → `installCli()` in `src/main/cli-install.js`, which
  writes a small launcher (`content` on POSIX, `content.cmd` on Windows) to a
  PATH directory (`/usr/local/bin` if writable, else `~/.local/bin`). The
  launcher runs `ELECTRON_RUN_AS_NODE=1 <electron> <cli entry> "$@"` with
  `AEM_DESKTOP_USER_DATA` pointed at the app's user-data dir — so it needs no
  system Node install.
- **Packaging.** `ELECTRON_RUN_AS_NODE` runs as vanilla Node and **cannot read
  modules inside the asar**, so `electron-builder.yml` marks `src/cli/**` and
  `src/main/**` as `asarUnpack`; the install handler points the launcher at the
  unpacked `app.asar.unpacked/src/cli/content.js`.
- **Safety.** `upload` mutates remote content, so it prompts for confirmation
  (skip with `-y`/`--yes`; refuses in a non-TTY without it). `--dry-run` on
  `update`/`upload` reports changes without applying them.
- Keep pure CLI logic in `src/cli/cli-lib.js` (arg parsing, site selection) and
  unit test it; the launcher-script builders in `cli-install.js` are pure and
  tested too.

## Hot reload (bundler-free)

`npm run dev` runs `scripts/dev.js`, which splits reload by process:

- **Renderer** (`src/renderer/**`): watched in-process by `dev-reload.js`, which
  calls `webContents.reloadIgnoringCache()`. Fast, no restart.
- **Main / preload** (`src/main/**`, `src/preload/**`): watched by `dev.js`,
  which kills and respawns Electron, since these run out of process.

True module-level HMR requires a bundler runtime; we deliberately use full
reload to stay bundler-free. The renderer is plain ESM so reloads are instant.

### CDP remote debugging (dev only)

`npm run dev` launches Electron with the Chrome DevTools Protocol enabled
(`--remote-debugging-port`, default `9223`, override with `AEM_DESKTOP_CDP_PORT`)
and `--remote-allow-origins=*`, so an agent or tool can attach over CDP
(e.g. `http://localhost:9223/json`). Port `9223` is used because Chrome's default
remote-debugging port is `9222`. This is wired only in `scripts/dev.js`;
packaged builds never enable it.

### Screenshot-on-double-click (dev only)

In development, **double-clicking anywhere in the UI** captures a screenshot of
the window. The main process (`dev:capture-screenshot` IPC in `index.js`) writes
it to a PNG in the OS temp dir and logs the absolute path to **stderr** via the
logger, so an agent can pick it up:

```
HH:MM:SS.mmm (screenshot) › /var/folders/.../aem-desktop-<timestamp>.png
```

The handler is a no-op in packaged builds (`app.isPackaged`). The renderer wiring
is a single `dblclick` listener in `renderer.js`; the bridge call is
`window.aemDesktop.captureScreenshot()`.

## Logging

Use the shared logger (`src/main/logger.js`, backed by `electron-log`) instead of
`console.log` in main-process code. It timestamps, scopes, persists to the OS log
dir, and routes by level: **`error`/`warn` → stderr**, everything else → stdout.
Dev scripts that run under plain Node use `electron-log/node` (see `scripts/dev.js`).
Renderer `console.*` is forwarded through the logger in dev (see `forwardRendererConsole`
in `dev-reload.js`) so it appears in the `npm run dev` terminal.

## Auto-update

`updater.js` wires `electron-updater` to the GitHub release feed declared in
`electron-builder.yml` (`publish: github`). On launch a packaged app checks the
latest release, downloads in the background, and installs on quit
(`autoInstallOnAppQuit`). Updates are **disabled in development** and can be
force-disabled with `AEM_DESKTOP_DISABLE_UPDATES=1` (see `update-policy.js`).

The macOS update channel needs the **ZIP** target plus `latest-mac.yml`; the
Windows channel uses the **NSIS** installer plus `latest.yml`. All are produced
by electron-builder and attached to each GitHub release by semantic-release.
electron-updater picks the right feed per platform automatically. macOS
auto-update only works on a **signed + notarized** build; Windows auto-update
works even unsigned (SmartScreen just warns until a cert is added).
macOS builds are **Apple Silicon (arm64) only** — Intel Macs are EOL; Windows
builds are **x64 only** (add an `arm64` entry under `win.target` to also ship
Windows-on-ARM).

## Release pipeline

Releases are fully automated by `.github/workflows/release.yaml` on every push
to `main`. Because macOS artifacts must be built/signed on a macOS runner and
Windows on a Windows runner, the workflow is **four jobs**:

1. **version** (Linux) — lint + test, then a `semantic-release --dry-run` to
   compute the next version once. Skips the rest if there's nothing to release.
2. **build-mac** (macOS) — `electron-builder --mac` (signed + notarized),
   stamped with the computed version; uploads the DMG/ZIP/blockmaps/`latest-mac.yml`
   as a workflow artifact.
3. **build-win** (Windows) — `electron-builder --win` (currently **unsigned**),
   same version; uploads the NSIS `.exe`/blockmap/`latest.yml`.
4. **release** (Linux) — downloads both artifact sets into `dist/`, then runs
   semantic-release with `SEMANTIC_RELEASE_SKIP_BUILD=true` so its **exec** step
   attaches the prebuilt files instead of rebuilding. semantic-release still runs
   **commit-analyzer/release-notes**, **changelog**, **npm** (`npmPublish: false`
   version bump), **github** (create release + attach mac & win assets), and
   **git** (commit the bump as `chore(release): <v>`).

> **Why compute the version in a separate job?** electron-builder stamps each
> artifact's filename and the `latest*.yml` feed with the version
> (`-c.extraMetadata.version=<v>`), so the platform builders need it *before*
> semantic-release runs for real. All four jobs check out the same commit, so
> the dry-run version and the final release version are identical.

### Required GitHub secrets (signing + notarization)

| Secret                         | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `APPLE_CERTIFICATE_BASE64`     | Developer ID Application cert (`.p12`, base64) → `CSC_LINK` |
| `APPLE_CERTIFICATE_PASSWORD`   | Password for the `.p12` → `CSC_KEY_PASSWORD`       |
| `APPLE_ID`                     | Apple ID for notarization                          |
| `APPLE_APP_SPECIFIC_PASSWORD`  | App-specific password for that Apple ID            |
| `APPLE_TEAM_ID`                | Apple Developer Team ID                            |
| `RELEASE_TOKEN`                | Admin-owned PAT used as `GITHUB_TOKEN` for the release (and the version-detection dry-run); bypasses the `main-protection` ruleset so the `chore(release)` commit/tag can push to `main` |

Windows signing is **not configured yet** — the Windows job builds unsigned.
To sign later, add a code-signing certificate as `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` secrets (or wire up a cloud-HSM signer such as Azure
Trusted Signing) and reference them in the `build-win` job.

Until the Apple secrets exist, `release.yaml`'s macOS job will fail at signing;
`main.yaml` always runs an **unsigned** packaging smoke test on **both** macOS
and Windows so config stays green.

> **Why a PAT and not the default `GITHUB_TOKEN`?** The `main-protection`
> ruleset requires the `Test` status check on every push to `main`. The
> `github-actions[bot]` is not a bypass actor, so its push of the release
> commit is rejected (`GH013`). The ruleset's bypass list already allows the
> **Repository admin** role, so `RELEASE_TOKEN` must be a PAT (classic `repo`
> scope, or fine-grained with **Contents: read/write** on this repo) owned by a
> repo admin. `[skip ci]` in the release commit keeps the PAT push from
> triggering a recursive workflow run.

> The `publish.owner`/`publish.repo` in `electron-builder.yml` (`adobe/aem-desktop`)
> must match the actual repository, or electron-updater will look in the wrong place.

## Conventions

- **Conventional Commits** drive releases: `feat:` → minor, `fix:`/`perf:` →
  patch, `feat!:`/`BREAKING CHANGE:` → major. `chore:`/`docs:`/`test:`/`refactor:`
  do not release. See `CONTRIBUTING.md`.
- **Apache 2.0 header** on every `.js`/`.cjs` source file (ESLint enforces it).
- **`save-exact=true`** (`.npmrc`) — dependencies are pinned.
- Keep main-process logic in small **pure modules** (like `window-options.js`,
  `update-policy.js`) so it is testable under `node --test` without Electron.
- Add tests for new pure logic; add a config integration test (see
  `test/release-config.test.js`) when changing the build/release wiring.

## Adding to the shell (quick recipe)

1. Add an IPC handler in `src/main/index.js` (`ipcMain.handle('feature:x', …)`).
2. Expose it in `src/preload/index.cjs` (`featureX: () => ipcRenderer.invoke('feature:x')`).
3. Call `window.aemDesktop.featureX()` from `src/renderer/renderer.js`.
4. Put non-Electron logic in a pure module under `src/main/` and unit test it.
5. `npm run lint && npm test`, then commit with a Conventional Commit message.
