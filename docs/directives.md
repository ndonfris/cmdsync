# Directives

```text
<!-- CMDSYNC [mode] [start] [format=...] [lang=...]: command -->
...
<!-- CMDSYNC end -->
```

The mode says what the output replaces:

| Mode | Replaces | End comment | Files |
| --- | --- | --- | --- |
| [`start` or `region start`](#region) | every line up to the end comment | `<!-- CMDSYNC end -->` | any |
| [`start`, on one line](#inline) | the text between the start and end comment | `<!-- CMDSYNC end -->`, same line | block comments (`<!-- -->`, `/* */`, ...) |
| [`line`](#line) | the next line (the output must be one line) | none | any |
| [`codeblock`](#codeblock) | the body of the next fenced code block | none | markdown, mdx |
| [`console`](#console) | the next fenced code block, with `$ command` and its output | none | markdown, mdx |
| [`console-pretty`](#console) | the next two fenced code blocks: the command, then its output | none | markdown, mdx |

`start` marks a directive that has an end comment, so the pair reads `CMDSYNC start` … `CMDSYNC end`. It's short for `region start`, so `<!-- CMDSYNC start: cmd -->` is always a region, even before a code block; the examples below use the short form. `region start` and `region` alone work too. `line`, `codeblock` and the `console` modes don't take `start`, because they have no end comment.

Without a mode, cmdsync infers it: a fenced code block after the directive (in markdown) means `codeblock`, an end comment on the same line means inline, and anything else is a `region`. Naming the mode (or writing `start`) makes the directive self-explanatory and turns mistakes into clear errors, like "expected a fenced code block" instead of a missing end comment, so prefer it.

`format=md-table` or `format=html-table` renders the command's output as a [table](#tables).

`include=../path` [takes the content from a file](#including-files) instead of a command: `<!-- CMDSYNC start include=../src/example.ts#L10-L20 -->`.

## region

Every line between the start and end comment is replaced. The output is indented to match the start comment, so regions also work inside yaml and nested lists. `start` and `region start` are the same:

````markdown
## Options
<!-- CMDSYNC start: my-cli --help -->
<!-- CMDSYNC end -->

## Version
<!-- CMDSYNC region start: my-cli --version -->
<!-- CMDSYNC end -->
````

```yaml
jobs:
  test:
    steps:
      # CMDSYNC start: my-cli ci-steps --yaml
      - run: generated
      # CMDSYNC end
```

## line

The line right after the directive is replaced, and no end comment is needed. The output must be exactly one line (trailing newlines are ignored), and it's indented like the directive. This is the way to update a single value in files with line comments (`#`, `//`), where an inline region can't be written.

```ts
// CMDSYNC line: node -p '`export const VERSION = "${require("./package.json").version}";`'
export const VERSION = "1.2.3";
```

```markdown
<!-- CMDSYNC line: echo "![version](https://img.shields.io/badge/version-$(my-cli --version)-blue)" -->
![version](https://img.shields.io/badge/version-1.2.3-blue)
```

The next line must be content, not another directive, an end comment or a code fence.

## codeblock

In markdown and mdx, the directive is followed (after optional blank lines) by a fenced code block, and **only the body** of that block is replaced. The fences and info string stay (unless `lang=` is set, see below), and no end comment is needed.

````markdown
<!-- CMDSYNC codeblock: my-cli completions fish -->
```fish
this content is replaced
```
````

Add `lang=` to set the block's language. It replaces the first word of the info string (attributes after it, like `title="..."`, are kept), and if no fenced block follows the directive, one is created:

````markdown
<!-- CMDSYNC codeblock lang=fish: my-cli completions fish -->
````

becomes

````markdown
<!-- CMDSYNC codeblock lang=fish: my-cli completions fish -->
```fish
complete -c my-cli ...
```
````

A created block uses a fence longer than any fence in the output, so output that contains code blocks of its own stays intact. `lang` only applies to `codeblock` directives.

`` ``` `` and `~~~` fences both work, including longer fences (` ```` `) that wrap nested blocks. In markdown files, directives shown inside fenced code or inline code (like the examples in these docs) are ignored.

## console

`console` shows the command with its output, the way it looks in a terminal. The directive owns the fenced code block after it, and creates it if there's none:

````markdown
<!-- CMDSYNC console: my-cli --version -->
```console
$ my-cli --version
1.2.3
```
````

`console-pretty` writes two blocks instead: the command, highlighted as `lang` (`sh` by default), then its output as `txt`:

````markdown
<!-- CMDSYNC console-pretty lang=fish: my-cli env -->
```fish
my-cli env
```

```txt
MY_CLI_HOME=~/.config/my-cli
```
````

Both are markdown/mdx only, and replace the block(s) right after the directive (only blank lines may come before each), so `console-pretty` takes the next two fenced blocks: keep unrelated code blocks out of that spot. `lang=` changes the language (`console lang=shell-session`). They don't take `format=` or `include=`, since the point is showing the real command.

## inline

A region whose start and end comment are on the same line: the text between them is replaced with the trimmed output. Use it for html elements, badges, or a version in a sentence.

```html
<p>Latest release: <span class="version"><!-- CMDSYNC start: my-cli --version -->1.2.3<!-- CMDSYNC end --></span></p>
```

## Including files

`include=` in place of `: command` takes the content from a file instead of running something. The path is relative to the file the directive is in, and `#L10-L20` (or `#L10`, `#L10-` for the rest of the file) picks a range of lines. A range is dedented, so a snippet from inside a function starts at column 0.

````markdown
<!-- CMDSYNC codeblock lang=ts include=../src/example.ts#L10-L20 -->
```ts
lines 10 to 20 of src/example.ts
```

<!-- CMDSYNC start include=../CONTRIBUTING.md -->
<!-- CMDSYNC end -->
````

It works with every mode, and with `format=` (`include=codes.json format=md-table`) and `lang=`. Includes don't run anything, so they don't need to be in [`commands`](configuration.md#recognized-commands). A missing file, or a range past the end of it, fails the directive and leaves its content as it was.

## Tables

Use `format=md-table` or `format=html-table` to turn a JSON array printed by the command into a table. The array can hold objects, where the keys become columns in the order they're first seen, or arrays, where the first row is the header.

````markdown
<!-- CMDSYNC start format=md-table: my-cli list-codes --json -->
| code | message |
| ---- | ------- |
<!-- CMDSYNC end -->
````

```console
$ my-cli list-codes --json
[{"code":1001,"message":"missing end"},{"code":1002,"message":"unused variable"}]
```

````markdown
<!-- CMDSYNC start format=md-table: my-cli list-codes --json -->
| code | message |
| ---- | ------- |
| 1001 | missing end |
| 1002 | unused variable |
<!-- CMDSYNC end -->
````

The markdown table aligns every column but the last and escapes `|`. The html table escapes `& < > " { }`, so it's also valid inside `.mdx`. Newlines in cells become `<br />`.

## MDX

MDX doesn't allow html comments, so `.mdx` files use JSX comments:

```mdx
{/* CMDSYNC start format=html-table: my-cli list-codes --json */}
{/* CMDSYNC end */}
```

## Changelogs

A changelog section is just a region:

```markdown
# Changelog

<!-- CMDSYNC start: git-cliff --unreleased --strip all -->
<!-- CMDSYNC end -->
```

## Any other file

```fish
# CMDSYNC start: my-cli completions fish
complete -c my-cli ...
# CMDSYNC end
```

## Ignoring a range

Directives between `<!-- CMDSYNC ignore start -->` and `<!-- CMDSYNC ignore end -->` aren't run, and the text between them is left exactly as it is. Use it for documentation that shows directives as examples, outside of a fenced code block:

````markdown
<!-- CMDSYNC ignore start -->
Write this, and run `cmdsync`:

<!-- CMDSYNC start: my-cli --version -->
<!-- CMDSYNC end -->
<!-- CMDSYNC ignore end -->
````

It uses the file's comment syntax (`# CMDSYNC ignore start` in a shell script) and your `marker`. Examples inside fenced code blocks and inline code are already ignored in markdown, so a fenced example of `ignore end` doesn't end the range. An `ignore start` that nothing ends is an error, and `cmdsync lint` reports an `ignore end` without a start as a stray marker.

## Comment syntax

The comment syntax is picked from the file name. Line comments like `#` have no closing delimiter, so in those files the directive runs to the end of its line and regions are block-only.

<!-- CMDSYNC start format=md-table: node scripts/syntax-table.ts -->
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
<!-- CMDSYNC end -->

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
; BEGIN_GENERATED region: my-cli defaults --ini
timeout = 30
; END_GENERATED
```

| Rule key | Description |
| --- | --- |
| `include` | Globs (relative to the config's directory) |
| `comment` | `["#"]` for line comments, `["<!--", "-->"]` for block comments |
| `marker` | Start text (default: the top-level `marker`) |
| `endMarker` | End text (default: the rule's `marker` + ` end`, else the top-level `endMarker`) |
| `fences` | Treat as markdown: ignore fenced/inline code, allow the fenced code block form |

For a one-off run, `--comment` sets the delimiters for every file:

```fish
cmdsync --comment '#' deploy/values.tpl
cmdsync --comment '/* */' --marker GEN legacy/*.styl
```

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/directives.md -->
---

[← Global install](global-install.md) · [Contents](README.md) · [Custom directives →](custom-directives.md)
<!-- CMDSYNC end -->
