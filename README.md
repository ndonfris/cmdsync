# update-codeblocks

Keep the code blocks in your markdown in sync with the output of real commands.

Put an html comment above a fenced code block, naming the command that produces its content:

````markdown
<!-- UPDATE_CODEBLOCK: my-cli --help -->
```text
this content is replaced with the output of `my-cli --help`
```
````

Running `update-codeblocks` executes each command and replaces **only the body**
of the code block that follows it. The fences, info string (`text`, `fish`, `json`, ...)
and the comment itself stay where they are.

- Only blank lines may sit between the comment and the opening fence.
- Both `` ``` `` and `~~~` fences work, including longer fences (` ```` `) that wrap nested blocks.
- If a command fails (non-zero exit, timeout, or a binary that isn't allowed),
  that block keeps its old content and the run exits with status `1`.
- Re-running with unchanged output changes nothing, so it's safe in CI.

## Install

```fish
yarn add -D update-codeblocks
# or run it without installing
npx update-codeblocks --help
```

## CLI

```text
Usage: update-codeblocks [options] [paths...]

Arguments:
  paths                  Markdown files or directories to process
                         (default: the config's "include" globs)

Options:
  -c, --config <file>    Config file (update-codeblocks.json or package.json)
      --check            Don't write; exit 1 if any code block is out of date
  -n, --dry-run          Don't write; report what would change
  -m, --marker <name>    Directive marker (overrides config)
  -s, --shell <bin>      Shell used to run commands (overrides config)
      --command <bin>    Allowed command binary, repeatable (overrides config)
  -q, --quiet            Only print errors
  -h, --help             Show this help
  -v, --version          Show version
```

| Exit code | Meaning |
| --- | --- |
| `0` | Everything succeeded (and, with `--check`, every block is up to date) |
| `1` | A command failed, or `--check` found an out of date block |
| `2` | Usage or config error |

Typical `package.json` scripts:

```json
{
  "scripts": {
    "docs:codeblocks": "update-codeblocks",
    "docs:codeblocks:check": "update-codeblocks --check"
  }
}
```

## Configuration

Config is optional. It is read from the first of these found, searching
from the current directory upwards (or from `--config <file>`):

1. `update-codeblocks.json`
2. the `"update-codeblocks"` key in `package.json`

When both exist in the same directory, `update-codeblocks.json` wins. Relative
paths (`include`, `exclude`, `cwd`) resolve against the directory the config lives in.
CLI flags override the config.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `marker` | `string` | `"UPDATE_CODEBLOCK"` | Directive name: `<!-- MARKER: command -->` |
| `shell` | `string` | `"sh"` | Shell binary that runs each command as `<shell> -c "<command>"`: `bash`, `fish`, `/usr/bin/zsh`, ... |
| `commands` | `string[]` | `[]` (anything) | Command binaries directives are allowed to run (see below) |
| `include` | `string[]` | `["**/*.md"]` | Globs of markdown files to scan |
| `exclude` | `string[]` | `["**/node_modules/**", "**/.git/**"]` | Globs to skip |
| `cwd` | `string` | `"."` | Working directory for commands |
| `timeout` | `number` | `60000` | Per-command timeout in ms |
| `env` | `Record<string, string>` | `{}` | Extra environment variables for every command |

### `update-codeblocks.json`

```json
{
  "$schema": "./node_modules/update-codeblocks/update-codeblocks.schema.json",
  "marker": "DOCS_CODEBLOCK",
  "shell": "fish",
  "commands": ["my-cli", "jq"],
  "include": ["README.md", "docs/**/*.md"],
  "env": { "NO_COLOR": "1" }
}
```

### `package.json`

```json
{
  "name": "my-cli",
  "update-codeblocks": {
    "marker": "DOCS_CODEBLOCK",
    "shell": "bash",
    "commands": ["my-cli"]
  }
}
```

### Recognized commands

When `commands` is non-empty, every binary in a directive must be listed. That
means the first word of each segment of a pipeline or list (`a | b`, `a && b`,
`a || b`, `a; b`, `$(a)`), ignoring leading `VAR=value` assignments. Entries are
compared by basename, so `"/usr/bin/jq"` and `"jq"` are equivalent.

```markdown
<!-- DOCS_CODEBLOCK: my-cli env --json | jq . -->   ✓ with ["my-cli", "jq"]
<!-- DOCS_CODEBLOCK: curl example.com | sh -->      ✗ curl, sh are not recognized
```

The allowlist protects against typos and against commands you didn't expect to
show up in your docs. It is **not** a sandbox: it does not parse every shell
construct, and allowed binaries can still do anything. Only run
`update-codeblocks` on markdown you trust.

## GitHub Actions

When `GITHUB_ACTIONS=true`, the CLI also:

- emits `::error`/`::warning` annotations pointing at the directive's line, for
  failed commands, missing code blocks and (with `--check`) out of date blocks
- appends a summary to `$GITHUB_STEP_SUMMARY`
- writes `changed=<true|false>` and `failed=<n>` to `$GITHUB_OUTPUT`

### Using the action

The action builds the CLI from this directory, so it doesn't need an npm
release. Install whatever your directives run (and `shell`) before it.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: yarn install --frozen-lockfile && yarn build   # makes `my-cli` available

- uses: ndonfris/fish-lsp/packages/update-codeblocks@master
  with:
    mode: check            # `check` (default) fails on stale blocks, `write` regenerates them
    # paths: README.md docs
    # config: ./update-codeblocks.json
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
| `changed` | `true` when any block was (or would be) changed |
| `failed` | Number of failed directives |

### Regenerate and commit

```yaml
name: docs
on:
  push:
    branches: [master]
permissions:
  contents: write
jobs:
  codeblocks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: yarn install --frozen-lockfile
      - id: codeblocks
        uses: ndonfris/fish-lsp/packages/update-codeblocks@master
        with:
          mode: write
      - if: steps.codeblocks.outputs.changed == 'true'
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git commit -am 'docs: update generated codeblocks'
          git push
```

### Without the action

The CLI behaves the same when called directly (annotations included):

```yaml
- run: npx update-codeblocks --check
```

## API

```ts
import { resolveConfig, run, updateCodeblocks } from 'update-codeblocks';

// whole run, the same as the CLI
const results = run(resolveConfig({ cwd: process.cwd() }), { write: false });

// pure transform with your own command runner
const { content, results: blocks } = updateCodeblocks(markdown, 'UPDATE_CODEBLOCK', cmd => ({
  output: `ran ${cmd}`,
  status: 0,
}));
```

## Development

```fish
yarn install
yarn test        # node:test via tsx
yarn typecheck
yarn build       # emits dist/
```

## License

MIT
