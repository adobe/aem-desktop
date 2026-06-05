# AEM Desktop

Desktop application for **Adobe Experience Manager Edge Delivery Services**.

This repository is the development foundation: an Electron shell wired with hot
reload, in-app auto-update, and a signed/notarized macOS release pipeline driven
by semantic-release. Feature development starts from here.

## Requirements

- Node.js 24 (see `.nvmrc`); Node >= 20 supported
- macOS for building/signing the DMG

## Getting started

```bash
npm install
npm run dev      # hot-reloading development build
```

## Scripts

| Command             | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Run the app with hot reload (renderer) + restart (main)  |
| `npm start`         | Run the app once, no watchers                            |
| `npm run lint`      | ESLint (`@adobe/eslint-config-helix`)                    |
| `npm test`          | Unit + config tests via `node --test`                   |
| `npm run build`     | Signed + notarized DMG/ZIP (requires Apple credentials)  |
| `npm run build:dir` | Unpacked `.app` for local inspection (no signing)        |

## Architecture

Pure ESM JavaScript, no bundler. The renderer runs sandboxed with context
isolation; all privileged calls cross a minimal `contextBridge` in
`src/preload/index.cjs`. See [`CLAUDE.md`](CLAUDE.md) for the full module map,
hot-reload model, auto-update flow, and release process.

## Releases

Pushes to `main` trigger [semantic-release](https://semantic-release.gitbook.io/):
it computes the version from [Conventional Commits](CONTRIBUTING.md), builds and
notarizes the macOS artifacts with electron-builder, and publishes a GitHub
release that doubles as the electron-updater feed. Signing requires the Apple
secrets documented in [`CLAUDE.md`](CLAUDE.md#required-github-secrets-signing--notarization).

## License

[Apache License 2.0](LICENSE).
