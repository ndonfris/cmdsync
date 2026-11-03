# Local install

Install cmdsync as a dev dependency of the project whose files it keeps up to date. The version is then pinned in the lockfile, so contributors, CI and the git hook all run the same one. Requires Node.js `>=22.18`.

```fish
# with npm
npm install -D cmdsync

# with yarn
yarn add -D cmdsync

# with pnpm
pnpm add -D cmdsync

# with bun
bun add -d cmdsync

# or run it without installing
npx cmdsync --help
```

## Running it

The binary lands in `node_modules/.bin`, so run it through the package manager:

| Package manager | Command |
| --- | --- |
| npm | `npx cmdsync` (or `npm exec -- cmdsync` when passing options) |
| yarn | `yarn cmdsync` |
| pnpm | `pnpm exec cmdsync` |
| bun | `bunx cmdsync` |

Or give it `package.json` scripts, which run with `node_modules/.bin` on `PATH`:

```json
{
  "scripts": {
    "docs": "cmdsync",
    "docs:check": "cmdsync check"
  }
}
```

`npx cmdsync` also works without installing anything (it downloads the latest version each time), which is handy for trying it out but doesn't pin a version.

## In CI and git hooks

- CI: run the check script (`npm run docs:check`) after installing dependencies, or use the [GitHub Action](github-actions.md).
- Git hooks: [`cmdsync hook install`](git-hooks.md) adds the local install to the pre-commit hook, run through the package manager whose lockfile it finds (`yarn cmdsync --staged`, `pnpm exec cmdsync --staged`, `bunx cmdsync --staged`, else `npm exec -- cmdsync --staged`).

## Upgrading

```fish
npm install -D cmdsync@latest   # or: yarn upgrade cmdsync --latest, pnpm update cmdsync --latest, bun update cmdsync
```

Then run `cmdsync` once and commit what it regenerates, so the docs match the new version's output. After a major version, [`cmdsync migrate`](migrating.md) converts directives in older syntax.

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/local-install.md -->
---

[← Getting started](getting-started.md) · [Contents](README.md) · [Global install →](global-install.md)
<!-- CMDSYNC end -->
