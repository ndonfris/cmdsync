# Git hooks

`cmdsync --staged` is made for a pre-commit hook. It regenerates every included file (a doc usually goes stale because some *other* file changed), then `git add`s the files it changed, so they land in the same commit.

- A stale file that also has unstaged changes is not touched, and the commit is blocked (exit `1`), so your work in progress never gets staged by accident. Stage or stash it and commit again.
- Untracked files are left alone.
- A failed command or invalid directive also blocks the commit.

## `cmdsync hook install`

Works like lint-staged's setup: it adds the right line for your package manager (from the lockfile) to the pre-commit hook.

| Lockfile | Hook line |
| --- | --- |
| `yarn.lock` | `yarn cmdsync --staged` |
| `pnpm-lock.yaml` | `pnpm exec cmdsync --staged` |
| `bun.lock` / `bun.lockb` | `bunx cmdsync --staged` |
| `package-lock.json` or none | `npm exec -- cmdsync --staged` (npm needs the `--`) |
| no `package.json` | `cmdsync --staged` (global install) |

- No pre-commit hook yet: it creates one (in `.husky/pre-commit` when husky owns `core.hooksPath`, else in git's hooks directory).
- A pre-commit hook already exists, `core.hooksPath` points outside the repository (a global hooks directory), or a hook manager is configured: nothing is edited, and it prints what to add instead.

```console
$ cmdsync hook install
created .git/hooks/pre-commit
  yarn cmdsync --staged

$ cmdsync hook install   # with an existing .husky/pre-commit
.husky/pre-commit already exists, so it was left untouched. Add this to it:

  yarn cmdsync --staged
```

## Hook managers

**husky** (`.husky/pre-commit`):

```sh
yarn cmdsync --staged
```

**lefthook** (`lefthook.yml`):

```yaml
pre-commit:
  commands:
    cmdsync:
      run: yarn cmdsync --staged
```

**simple-git-hooks** (`package.json`):

```json
{
  "simple-git-hooks": {
    "pre-commit": "yarn cmdsync --staged"
  }
}
```

**pre-commit.com** (`.pre-commit-config.yaml`): pre-commit stashes unstaged changes itself and fails the commit when a hook modifies files, so its hook runs plain `cmdsync` (no `--staged`). When it regenerates something, review it, `git add` it, and commit again.

```yaml
repos:
  - repo: https://github.com/ndonfris/cmdsync
    rev: master
    hooks:
      - id: cmdsync
```

**Plain git** (`.git/hooks/pre-commit`, executable):

```sh
#!/bin/sh
npm exec -- cmdsync --staged
```

To only *verify* in the hook instead of regenerating, use `cmdsync --check`.

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/git-hooks.md -->
---

[← Configuration](configuration.md) · [Contents](README.md) · [GitHub Actions →](github-actions.md)
<!-- CMDSYNC end -->
