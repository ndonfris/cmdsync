# Global install

Install cmdsync globally to have `cmdsync` on your `PATH` in every repository, including ones that don't use Node. Requires Node.js `>=22.18`.

```fish
npm install -g cmdsync   # or: yarn global add cmdsync, pnpm add -g cmdsync, bun add -g cmdsync
cmdsync --version
```

A global install runs whatever version you installed last, so for a project that other people (or CI) work on, a [local install](local-install.md) is better: everyone runs the version in the lockfile. Inside a project with a local install, `npx cmdsync` / `yarn cmdsync` run the local one.

## The man page

`npm install -g` also installs a man page, `man cmdsync`, into `$(npm prefix -g)/share/man`. If `man cmdsync` finds nothing, that directory isn't on your manual path:

```fish
man -w cmdsync                                   # where man looks
set -gx MANPATH (npm prefix -g)/share/man $MANPATH
```

In fish, `set -gx MANPATH '' …` (an empty first entry) keeps the system defaults, worked out from your current `PATH`, instead of a fixed list.

## Node version managers

With nvm, fnm, volta and the like, global packages belong to the active Node version: after switching versions, install cmdsync again (or use the manager's option for carrying global packages over, like `nvm install --reinstall-packages-from`).

## Using it across repositories

A global cmdsync goes well with the global config, which has defaults for every repository and a list of repositories to run in together (`cmdsync --all`, `--group docs`):

```fish
cmdsync init global --add   # create it, and add the current repository
```

See [multiple repositories](configuration.md#multiple-repositories).

## Upgrading and removing

```fish
npm install -g cmdsync@latest   # or: yarn global upgrade cmdsync, pnpm update -g cmdsync, bun add -g cmdsync@latest
npm uninstall -g cmdsync        # or: yarn global remove cmdsync, pnpm remove -g cmdsync, bun remove -g cmdsync
```

To run your own checkout globally instead, see [building from source](development.md#building-from-source).

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/global-install.md -->
---

[← Local install](local-install.md) · [Contents](README.md) · [Directives →](directives.md)
<!-- CMDSYNC end -->
