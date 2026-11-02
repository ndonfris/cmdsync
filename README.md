# cmdsync

Keep generated parts of your files (docs, tables, changelogs, version strings, config snippets) in sync with the output of real commands.

Mark a region with a start and an end comment, naming the command that produces its content:

````markdown
<!-- CMDSYNC: my-cli --version -->
this line is replaced with the output of `my-cli --version`
<!-- /CMDSYNC -->
````

Running `cmdsync` executes each command and replaces **only what's between the comments**. The comments stay where they are, so running it again regenerates the same region.

- Works in any file with comments: markdown, mdx, html, yaml, shell, TypeScript, ... ([built-in syntax table](#comment-syntax), or [your own](#custom-syntax)).
- Has no runtime dependencies.
- If a command fails (non-zero exit, timeout, or a binary that isn't allowed), its region keeps its old content and the run exits with status `1`.
- Re-running with unchanged output changes nothing, so it's safe in CI.

## Regions

### Block

Everything between the start and end comment is replaced. The output is indented to match the start comment, so regions also work inside yaml and nested lists.

````markdown
## Options
<!-- CMDSYNC: my-cli --help -->
<!-- /CMDSYNC -->
````

```yaml
jobs:
  test:
    steps:
      # CMDSYNC: my-cli ci-steps --yaml
      - run: generated
      # /CMDSYNC
```

### Inline

Start and end comment on the same line: the text between them is replaced with the trimmed output. Use it for html elements, badges, or a version in a sentence.

```html
<p>Latest release: <span class="version"><!-- CMDSYNC: my-cli --version -->1.2.3<!-- /CMDSYNC --></span></p>
```

### Fenced code block (markdown)

In markdown and mdx, a start comment followed (after optional blank lines) by a fenced code block replaces **only the body** of that block. The fences and info string stay, and no end comment is needed.

````markdown
<!-- CMDSYNC: my-cli completions fish -->
```fish
this content is replaced
```
````

`` ``` `` and `~~~` fences both work, including longer fences (` ```` `) that wrap nested blocks. In markdown files, directives shown inside fenced code or inline code (like the examples in this README) are ignored.

### Tables

Use `format=md-table` or `format=html-table` to turn a JSON array printed by the command into a table. The array can hold objects, where the keys become columns in the order they're first seen, or arrays, where the first row is the header.

````markdown
<!-- CMDSYNC[format=md-table]: my-cli list-codes --json -->
| code | message |
| ---- | ------- |
<!-- /CMDSYNC -->
````

```console
$ my-cli list-codes --json
[{"code":1001,"message":"missing end"},{"code":1002,"message":"unused variable"}]
```

````markdown
<!-- CMDSYNC[format=md-table]: my-cli list-codes --json -->
| code | message |
| ---- | ------- |
| 1001 | missing end |
| 1002 | unused variable |
<!-- /CMDSYNC -->
````

The markdown table aligns every column but the last and escapes `|`. The html table escapes `& < > " { }`, so it's also valid inside `.mdx`. Newlines in cells become `<br />`.

### MDX

MDX doesn't allow html comments, so `.mdx` files use JSX comments:

```mdx
{/* CMDSYNC[format=html-table]: my-cli list-codes --json */}
{/* /CMDSYNC */}
```

### Changelogs

A changelog section is just a region:

```markdown
# Changelog

<!-- CMDSYNC: git-cliff --unreleased --strip all -->
<!-- /CMDSYNC -->
```

### Any other file

```fish
# CMDSYNC: my-cli completions fish
complete -c my-cli ...
# /CMDSYNC
```

```ts
export const VERSION =
  // CMDSYNC: node -p 'JSON.stringify(require("./package.json").version)'
  '1.2.3'
  // /CMDSYNC
;
```

## Comment syntax

The comment syntax is picked from the file name. Line comments like `#` have no closing delimiter, so in those files the directive runs to the end of its line and regions are block-only.

<!-- CMDSYNC[format=md-table]: tsx scripts/syntax-table.ts -->
| Comment        | Markdown | Files |
| -------------- | -------- | ----- |
| `<!--` … `-->` | yes      | `.md` `.markdown` |
| `{/*` … `*/}`  | yes      | `.mdx` |
| `<!--` … `-->` |          | `.html` `.htm` `.xml` `.svg` `.vue` `.svelte` `.astro` `.xhtml` `.plist` |
| `#`            |          | `.sh` `.bash` `.zsh` `.fish` `.ksh` `.nu` `.ps1` `.py` `.rb` `.pl` `.r` `.jl` `.cr` `.ex` `.exs` `.nim` `.yml` `.yaml` `.toml` `.conf` `.cfg` `.properties` `.tf` `.hcl` `.nix` `.cmake` `.mk` `.env` `.gitignore` `.dockerignore` `.npmignore` `.prettierignore` `.gitattributes` `.editorconfig` `.service` `Makefile` `GNUmakefile` `Dockerfile` `Containerfile` `Justfile` `justfile` `Gemfile` `Rakefile` `Brewfile` `Procfile` `CODEOWNERS` `Vagrantfile` `.bashrc` `.zshrc` `.profile` |
| `//`           |          | `.js` `.mjs` `.cjs` `.jsx` `.ts` `.mts` `.cts` `.tsx` `.jsonc` `.json5` `.c` `.h` `.cc` `.cpp` `.cxx` `.hpp` `.cs` `.java` `.kt` `.kts` `.scala` `.groovy` `.gradle` `.go` `.rs` `.swift` `.dart` `.zig` `.php` `.proto` `.scss` `.less` `.v` `.odin` |
| `/*` … `*/`    |          | `.css` |
| `--`           |          | `.lua` `.sql` `.hs` `.elm` `.ada` `.purs` |
| `;`            |          | `.ini` `.lisp` `.el` `.clj` `.cljs` `.scm` `.rkt` `.asm` `.s` |
| `%`            |          | `.tex` `.sty` `.erl` `.hrl` |
| `"`            |          | `.vim` `.vimrc` |
<!-- /CMDSYNC -->

Files that don't match any row (and aren't covered by a [`syntax` rule](#custom-syntax)) are an error, so add a rule or pass `--comment`.

### Custom syntax

Add `syntax` rules to cover other files, or to override the built-in table. The first rule whose `include` globs match a file wins, and each rule can also set its own start and end text:

```json
{
  "include": ["**/*.md", "conf/*.conf", "Dockerfile"],
  "syntax": [
    { "include": ["conf/*.conf"], "comment": [";"], "marker": "BEGIN_GENERATED", "endMarker": "END_GENERATED" },
    { "include": ["Dockerfile"], "comment": ["#"], "marker": "VERSIONS" }
  ]
}
```

```ini
; BEGIN_GENERATED: my-cli defaults --ini
timeout = 30
; END_GENERATED
```

| Rule key | Description |
| --- | --- |
| `include` | Globs (relative to the config's directory) |
| `comment` | `["#"]` for line comments, `["<!--", "-->"]` for block comments |
| `marker` | Start text (default: the top-level `marker`) |
| `endMarker` | End text (default: `/` + the rule's `marker`, else the top-level `endMarker`) |
| `fences` | Treat as markdown: ignore fenced/inline code, allow the fenced code block form |

For a one-off run, `--comment` sets the delimiters for every file:

```fish
cmdsync --comment '#' deploy/values.tpl
cmdsync --comment '/* */' --marker GEN legacy/*.styl
```

## Install

```fish
yarn add -D cmdsync
# or run it without installing
npx cmdsync --help
```

Requires Node.js `>=22.17`.

## CLI

<!-- CMDSYNC: tsx src/cli.ts --help -->
```text
Usage: cmdsync [options] [paths...]
       cmdsync completions <bash|zsh|fish|nu>
       cmdsync hook install

Replace comment-delimited regions of any file with the output of the
command named in the start comment:

  <!-- CMDSYNC: my-cli --version -->
  this line is replaced with the output of `my-cli --version`
  <!-- /CMDSYNC -->

In markdown, a start comment followed by a fenced code block replaces just
the body of that block, and no end comment is needed.

Arguments:
  paths                    Files or directories to process
                           (default: the config's "include" globs)

Commands:
  completions <shell>      Print a completion script for bash, zsh, fish or nu
  hook install             Add `cmdsync --staged` to the git pre-commit hook
                           (prints the line to add if a hook already exists)

Options:
  -c, --config <file>      Config file (cmdsync.json or package.json)
      --check              Don't write; exit 1 if any region is out of date
  -n, --dry-run            Don't write; report what would change
      --staged             Write, then `git add` the files that changed; refuses
                           files with unstaged changes (for a pre-commit hook)
  -m, --marker <name>      Start marker (overrides config)
  -e, --end-marker <name>  End marker (overrides config, default: /<marker>)
      --comment <delims>   Comment delimiters for every file, e.g. '#' or '/* */'
                           (overrides config and the built-in syntax table)
  -s, --shell <bin>        Shell used to run commands (overrides config)
      --command <bin>      Allowed command binary, repeatable (overrides config)
      --install            Run the config's "install" command for every binary
                           a directive uses, even if it's already on PATH
      --no-install         Never run "install" commands (default: only for
                           binaries that aren't on PATH)
  -q, --quiet              Only print errors
  -h, --help               Show this help
  -v, --version            Show version

Directive options: <!-- CMDSYNC[format=md-table]: cmd --> formats a JSON
array printed by cmd as a markdown table (or format=html-table).

Config is read from the nearest cmdsync.json, or the "cmdsync" key of
the nearest package.json.

Exit codes: 0 success, 1 failed command, invalid directive or out of date
region (--check), 2 usage error
```

| Exit code | Meaning |
| --- | --- |
| `0` | Everything succeeded (and, with `--check`, every region is up to date) |
| `1` | A command failed, a directive is invalid (unterminated region, unknown option), or `--check` found an out of date region |
| `2` | Usage or config error |

Typical `package.json` scripts:

```json
{
  "scripts": {
    "docs": "cmdsync",
    "docs:check": "cmdsync --check"
  }
}
```

### Shell completions

`cmdsync completions <shell>` prints a completion script for `bash`, `zsh`, `fish` or `nu`. The scripts are generated from the same option table the CLI parses, so they always match the installed version. POSIX `sh` has no completion system, so it isn't supported.

```fish
# bash: in ~/.bashrc
eval "$(cmdsync completions bash)"

# zsh: in ~/.zshrc (after compinit), or save it as _cmdsync somewhere in $fpath
eval "$(cmdsync completions zsh)"

# fish
cmdsync completions fish > ~/.config/fish/completions/cmdsync.fish

# nushell: save the module, then add `use completions/cmdsync.nu *` to config.nu
cmdsync completions nu | save -f ($nu.default-config-dir | path join completions cmdsync.nu)
```

A path literally named `completions` must be written as `./completions`.

## Configuration

Config is optional. It is read from the first of these found, searching from the current directory upwards (or from `--config <file>`):

1. `cmdsync.json`
2. the `"cmdsync"` key in `package.json`

When both exist in the same directory, `cmdsync.json` wins. Relative paths (`include`, `exclude`, `syntax[].include`, `cwd`) resolve against the directory the config lives in. CLI flags override the config.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `marker` | `string` | `"CMDSYNC"` | Start of a region: `<!-- MARKER: command -->` |
| `endMarker` | `string` | `"/" + marker` | End of a region: `<!-- /MARKER -->` |
| `shell` | `string` | `"sh"` | Shell binary that runs each command as `<shell> -c "<command>"`: `bash`, `fish`, `/usr/bin/zsh`, ... |
| `commands` | `string[]` | `[]` (anything) | Command binaries directives are allowed to run (see below) |
| `install` | `Record<string, string>` | `{}` | [How to install a binary](#installing-binaries) directives run, keyed by binary name |
| `include` | `string[]` | `["**/*.md", "**/*.mdx"]` | Globs of files to scan |
| `exclude` | `string[]` | `["**/node_modules/**", "**/.git/**"]` | Globs to skip |
| `syntax` | `SyntaxRule[]` | `[]` | [Comment syntax per glob](#custom-syntax) |
| `comment` | `string[]` | | Comment delimiters for every file (what `--comment` sets) |
| `cwd` | `string` | `"."` | Working directory for commands |
| `timeout` | `number` | `60000` | Per-command timeout in ms |
| `env` | `Record<string, string>` | `{}` | Extra environment variables for every command |

### `cmdsync.json`

```json
{
  "$schema": "./node_modules/cmdsync/cmdsync.schema.json",
  "shell": "fish",
  "commands": ["my-cli", "jq"],
  "include": ["README.md", "CHANGELOG.md", "docs/**/*.{md,mdx}", "completions/*.fish"],
  "env": { "NO_COLOR": "1" }
}
```

### `package.json`

```json
{
  "name": "my-cli",
  "cmdsync": {
    "shell": "bash",
    "commands": ["my-cli"]
  }
}
```

### Recognized commands

When `commands` is non-empty, every binary in a directive must be listed. That means the first word of each segment of a pipeline or list (`a | b`, `a && b`, `a || b`, `a; b`, `$(a)`), ignoring leading `VAR=value` assignments. Entries are compared by basename, so `"/usr/bin/jq"` and `"jq"` are equivalent.

```markdown
<!-- CMDSYNC: my-cli env --json | jq . -->   ✓ with ["my-cli", "jq"]
<!-- CMDSYNC: curl example.com | sh -->      ✗ curl, sh are not recognized
```

The allowlist protects against typos and against commands you didn't expect to show up in your docs. It is **not** a sandbox: it does not parse every shell construct, and allowed binaries can still do anything. Only run `cmdsync` on files you trust.

### Installing binaries

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

## Git hooks

`cmdsync --staged` is made for a pre-commit hook. It regenerates every included file (a doc usually goes stale because some *other* file changed), then `git add`s the files it changed, so they land in the same commit.

- A stale file that also has unstaged changes is not touched, and the commit is blocked (exit `1`), so your work in progress never gets staged by accident. Stage or stash it and commit again.
- Untracked files are left alone.
- A failed command or invalid directive also blocks the commit.

### `cmdsync hook install`

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

### Hook managers

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

## GitHub Actions

When `GITHUB_ACTIONS=true`, the CLI also:

- emits `::error` annotations pointing at the directive's line, for failed commands, invalid directives and (with `--check`) out of date regions
- appends a summary to `$GITHUB_STEP_SUMMARY`
- writes `changed=<true|false>` and `failed=<n>` to `$GITHUB_OUTPUT`

### Using the action

The action builds the CLI from source, so it doesn't need an npm release. Install whatever your directives run (and `shell`) before it.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: yarn install --frozen-lockfile && yarn build   # makes `my-cli` available (or use the `install` config)

- uses: ndonfris/cmdsync@master
  with:
    mode: check            # `check` (default) fails on stale regions, `write` regenerates them
    # paths: README.md docs
    # config: ./cmdsync.json
    # args: --shell bash --command my-cli
    # working-directory: .
```

| Input | Default | Description |
| --- | --- | --- |
| `mode` | `check` | `check` or `write` |
| `paths` | `''` | Space separated files/directories (default: config `include`) |
| `config` | `''` | Explicit config path |
| `args` | `''` | Extra CLI arguments |
| `working-directory` | `.` | Directory to run in |

| Output | Description |
| --- | --- |
| `changed` | `true` when any region was (or would be) changed |
| `failed` | Number of failed or invalid directives |

### Regenerate and commit

```yaml
name: docs
on:
  push:
    branches: [master]
permissions:
  contents: write
jobs:
  cmdsync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: yarn install --frozen-lockfile
      - id: cmdsync
        uses: ndonfris/cmdsync@master
        with:
          mode: write
      - if: steps.cmdsync.outputs.changed == 'true'
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git commit -am 'docs: regenerate cmdsync regions'
          git push
```

### Without the action

The CLI behaves the same when called directly (annotations included):

```yaml
- run: npx cmdsync --check
```

## API

```ts
import { resolveConfig, run, updateRegions } from 'cmdsync';

// whole run, the same as the CLI
const results = run(resolveConfig({ cwd: process.cwd() }), { write: false });

// pure transform with your own command runner
const syntax = { open: '<!--', close: '-->', fences: true, marker: 'CMDSYNC', endMarker: '/CMDSYNC' };
const { content, results: regions } = updateRegions(markdown, syntax, cmd => ({
  output: `ran ${cmd}`,
  status: 0,
}));
```

## Migrating from `update-codeblocks`

`cmdsync` was previously named `update-codeblocks`. Existing code block directives keep working as fenced code block regions, once you rename:

| `update-codeblocks` | `cmdsync` |
| --- | --- |
| `update-codeblocks.json` / `"update-codeblocks"` key | `cmdsync.json` / `"cmdsync"` key |
| default marker `UPDATE_CODEBLOCK` | default marker `CMDSYNC` (or set `"marker": "UPDATE_CODEBLOCK"`) |
| `uses: ndonfris/fish-lsp/packages/update-codeblocks@master` | `uses: ndonfris/cmdsync@master` |
| directive with no code block: warning, exit `0` | invalid directive: error, exit `1` |
| `results[].blocks`, kind `missing-codeblock` | `results[].regions`, kind `invalid` |

## Development

```fish
yarn install
yarn test        # node:test via tsx
yarn typecheck
yarn build       # emits dist/
yarn docs        # regenerate this README's regions with cmdsync itself
```

## License

MIT
