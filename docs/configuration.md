# Configuration

Config is optional. It is read from the first of these found, searching from the current directory upwards (or from `--config <file>`):

1. `cmdsync.json`
2. the `"cmdsync"` key in `package.json`

When both exist in the same directory, `cmdsync.json` wins. Relative paths (`include`, `exclude`, `syntax[].include`, `cwd`) resolve against the directory the config lives in. CLI flags override the config.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `marker` | `string` | `"CMDSYNC"` | Starts a directive: `<!-- MARKER start: command -->` |
| `endMarker` | `string` | `marker + " end"` | End of a region: `<!-- MARKER end -->` |
| `shell` | `string` | `"auto"` | Shell binary that runs each command as `<shell> -c "<command>"`: `bash`, `fish`, `/usr/bin/zsh`, ..., or `auto`, the shell cmdsync was started from (see [the shell](#the-shell)) |
| `commands` | `string[]` | `[]` (anything) | Command binaries directives are allowed to run (see below) |
| `install` | `Record<string, string>` | `{}` | [How to install a binary](#installing-binaries) directives run, keyed by binary name |
| `include` | `string[]` | `["**/*.md", "**/*.mdx"]` | Globs of files to scan |
| `exclude` | `string[]` | `["**/node_modules/**", "**/.git/**"]` | Globs to skip |
| `syntax` | `SyntaxRule[]` | `[]` | [Comment syntax per glob](directives.md#custom-syntax) |
| `comment` | `string[]` | | Comment delimiters for every file (what `--comment` sets) |
| `cwd` | `string` | `"."` | Working directory for commands |
| `timeout` | `number` | `60000` | Per-command timeout in ms |
| `env` | `Record<string, string>` | `{}` | Extra environment variables for every command |
| `postUpdate` | `string[]` | `[]` | Commands run after an update that wrote files, see [post-update commands](#post-update-commands) |

`cmdsync --show` prints the config in use (with `--config <file>`, that one), and `cmdsync --edit` opens it in `$VISUAL` or `$EDITOR` (`vi` if neither is set), then checks it when the editor exits, so a typo is reported right away. For a `package.json`, `--show` prints just its `"cmdsync"` key, and `--edit` opens the whole file. A broken config can still be shown and edited.

`cmdsync --show --resolved` (or just `--resolved`) prints the config a run would actually use instead: the built-in defaults, the [global config's `defaults`](#multiple-repositories), the config file and the flags, merged, with where each value came from (`install`, `env` and `directives` entry by entry, since those merge per key):

```jsonc
{
  "marker": "CMDSYNC",  // default
  "shell": "fish",  // global
  "commands": ["my-cli"],  // config
  "env": {
    "A": "local",  // config
    "B": "global"  // global
  },
  ...
}
```

```fish
cmdsync --show
cmdsync --edit --config docs/cmdsync.json
EDITOR="code --wait" cmdsync --edit --show   # edit, then print the result
```

## `cmdsync.json`

```json
{
  "$schema": "./node_modules/cmdsync/cmdsync.schema.json",
  "shell": "fish",
  "commands": ["my-cli", "jq"],
  "include": ["README.md", "CHANGELOG.md", "docs/**/*.{md,mdx}", "completions/*.fish"],
  "env": { "NO_COLOR": "1" }
}
```

## `package.json`

```json
{
  "name": "my-cli",
  "cmdsync": {
    "shell": "bash",
    "commands": ["my-cli"]
  }
}
```

## Recognized commands

When `commands` is non-empty, every binary in a directive must be listed. That means the first word of each segment of a pipeline or list (`a | b`, `a && b`, `a || b`, `a; b`, `$(a)`), ignoring leading `VAR=value` assignments. Entries are compared by basename, so `"/usr/bin/jq"` and `"jq"` are equivalent.

```markdown
<!-- CMDSYNC: my-cli env --json | jq . -->   ✓ with ["my-cli", "jq"]
<!-- CMDSYNC: curl example.com | sh -->      ✗ curl, sh are not recognized
```

The allowlist protects against typos and against commands you didn't expect to show up in your docs. It is **not** a sandbox: it does not parse every shell construct, and allowed binaries can still do anything. Only run `cmdsync` on files you trust.

## Installing binaries

`install` maps a binary name to the shell command that installs it. Before a directive runs, each binary it uses that has an `install` entry and isn't on `PATH` is installed. Each install runs at most once per run, with the same `shell`, `cwd` and `env` as directives, and a 10 minute timeout.

```json
{
  "shell": "bash",
  "commands": ["my-cli", "jq", "git-cliff"],
  "install": {
    "my-cli": "npm install --global my-cli@${MY_CLI_VERSION:-latest}",
    "jq": "sudo apt-get install -y jq",
    "git-cliff": "cargo install git-cliff"
  }
}
```

- If an install fails, or succeeds without putting the binary on `PATH`, every directive that uses that binary fails and keeps its old content.
- `--install` runs the install for every binary a directive uses, even ones already on `PATH`. Use it to pin a version in CI.
- `--no-install` never installs anything.
- Binaries are matched the same way as [`commands`](#recognized-commands): the first word of each pipeline/list segment, by basename.

## The shell

By default (`"shell": "auto"`) commands run in the shell you started cmdsync from: run it from fish and `<!-- CMDSYNC start: string upper hi -->` works, from bash it's bash. cmdsync walks up its parent processes to the first interactive shell, so the `sh -c` that `npx`/`yarn` and git hooks put in between doesn't count. Without an interactive shell (in CI, say) it takes the nearest shell, then `$SHELL`, then `sh`. A run prints which one, `shell: /usr/bin/fish (auto: parent)`, and so does `cmdsync --show --resolved`.

`CMDSYNC_SHELL=bash cmdsync` overrides the detection for a run (or a terminal, exported), and `-s`/`--shell` or a `shell` in a config pins it outright.

Commands written for one shell can mean something else in another (`$(...)`, `string`, `set`), so when a project's directives need a particular shell, set `"shell"` in its config: then contributors and CI all regenerate the same output. `auto` is best left to your [global `defaults`](#multiple-repositories), or projects whose commands are plain enough for any shell.

## Post-update commands

`postUpdate` commands run in order after `cmdsync update` (or plain `cmdsync`) writes at least one file: a formatter, a build of the docs site, ... They use the same shell, cwd and env as directives, plus `CMDSYNC_CHANGED_FILES`, the written files (one per line, relative to the config root). The first one that fails stops the rest and makes cmdsync exit 1.

```json
{
  "postUpdate": [
    "echo \"$CMDSYNC_CHANGED_FILES\" | xargs npx prettier --write"
  ]
}
```

`--post-update-cmds` runs them even when nothing changed, and `--no-post-update-cmds` skips them. They never run for `status`, `check`, `--dry-run` or `--diff`, since nothing is written. With [`--staged`](git-hooks.md) they run after the files are written and before they're staged, so their changes to those files are part of the commit.

## Multiple repositories

A global config holds defaults for every repository, and a list of repositories to run in together. It's `$CMDSYNC_GLOBAL_CONFIG`, or `$XDG_CONFIG_HOME/cmdsync/config.json` (`~/.config/cmdsync/config.json`):

```json
{
  "$schema": "https://unpkg.com/cmdsync/cmdsync.global.schema.json",
  "defaults": {
    "shell": "fish",
    "install": { "my-cli": "npm install -g my-cli" }
  },
  "repos": [
    { "path": "~/repos/A", "groups": ["docs"] },
    { "path": "~/repos/B", "groups": ["docs", "site"] },
    { "path": "~/work/C", "name": "c-docs" }
  ]
}
```

- `defaults` is merged under each repository's own config, which wins. `install` and `env` merge key by key, everything else is replaced. It applies to every run, not only the ones below.
- `cmdsync --all` runs in every repository, `--group docs` in those of a group, and `--repo A` (a name or path) in one. Both are repeatable, and work with `update`, `status`, `check` and `lint`: `cmdsync status --group docs` previews them all. Each repository uses its own config, so these can't be combined with paths, `--config` or `--staged`. The exit code is the worst of them.
- `name` defaults to the directory's name. Paths under your home directory are stored as `~/...`, so the file works on other machines.

Manage it from the CLI:

```fish
cmdsync init global                  # create it
cmdsync init global --add            # ... and add this repository
cmdsync repos add ~/repos/B --group docs --group site
cmdsync repos add . --name c-docs
cmdsync repos                        # list them (and flag missing paths)
cmdsync repos remove c-docs
```

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/configuration.md -->
---

[← CLI](cli.md) · [Contents](README.md) · [Git hooks →](git-hooks.md)
<!-- CMDSYNC end -->
