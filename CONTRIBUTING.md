# Contributing

## Commit messages

This project releases automatically with
[semantic-release](https://semantic-release.gitbook.io/), so commit messages
must follow [Conventional Commits](https://www.conventionalcommits.org/):

| Type                         | Release |
| ---------------------------- | ------- |
| `fix:`, `perf:`              | patch   |
| `feat:`                      | minor   |
| `feat!:` / `BREAKING CHANGE:`| major   |
| `chore:`, `docs:`, `test:`, `refactor:`, `ci:`, `style:` | none |

Example:

```
feat: add project switcher to the window toolbar
```

## Before opening a PR

```bash
npm run lint
npm test
```

A Husky `pre-commit` hook runs `lint-staged` (ESLint) on staged files.

## Code conventions

- Pure ESM JavaScript; no TypeScript, no bundler.
- Every `.js`/`.cjs` file starts with the Apache 2.0 license header (ESLint
  enforces this).
- Keep main-process logic in small pure modules so it can be unit tested under
  `node --test` without the Electron runtime.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture and release pipeline.
