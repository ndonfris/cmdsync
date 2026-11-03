# Custom directives

Define your own directives in the config's `directives`, and use their names like a mode: `<!-- CMDSYNC quote start: my-cli greet -->`. Each one runs a command, then turns its output into what's written, with a `template`, a `formatter` module, or both:

```json
{
  "directives": {
    "quote": { "template": "{output|quote}" },
    "usage": { "mode": "codeblock", "lang": "text", "command": "{cmd} --help" },
    "version": { "mode": "line", "command": "my-cli --version", "template": "**{params.label|default:Version}:** `{output|trim}`" },
    "terminal": { "formatter": "./scripts/terminal.ts" }
  }
}
```

```markdown
<!-- CMDSYNC usage: my-cli -->
<!-- CMDSYNC version label=Latest: - -->
<!-- CMDSYNC terminal start lang=fish caption=Install: my-cli install -->
<!-- CMDSYNC end -->
```

| Key | Meaning |
| --- | --- |
| `mode` | The built-in mode that writes the result: `region` (default), `line`, `codeblock`, `console`, `console-pretty`. `start` and the end marker work the same as for that mode. |
| `command` | The command to run, with `{cmd}` for what the directive says (default: `{cmd}`). Any placeholder below works except the output ones. |
| `lang`, `format` | Defaults for `lang=` and `format=`. `format` applies to the output before the formatter and template. |
| `template` | The text written, with placeholders and filters (below). Runs after `formatter`, with its result as `{output}`. |
| `formatter` | A JS or TS module, relative to the config root. Its default export (or `format` export) gets the output and returns what's written. |
| `description` | Free text for people reading the config. |

On top of `format=`, `lang=` and `include=`, a custom directive takes any `key=value` word, which its template sees as `{params.key}` and its formatter as `ctx.params.key`. Values can use letters, digits and `_ . - + # / @ ~` (no spaces). [`examples/custom-directives`](../examples/custom-directives) has a working setup of each kind.

## Templates

| Placeholder | Value |
| --- | --- |
| `{output}` | the command's output (after `format=`), or the formatter's result |
| `{input}` (or `{cmd}`) | the command as written in the directive |
| `{command}` | the command that ran (the custom directive's `command`, filled in) |
| `{name}`, `{mode}`, `{lang}` | the directive's name, base mode, and `lang=` |
| `{file}`, `{dir}`, `{line}` | the file with the directive (relative to the config root), its directory, the directive's line |
| `{marker}` | the config's marker |
| `{date}`, `{datetime}`, `{year}` | when it ran (UTC): `2026-11-02`, ISO 8601, `2026` |
| `{fence}` | a backtick fence longer than any inside `{output}`: `{fence}sh` … `{fence}` |
| `{env.NAME}` | an environment variable (the config's `env` included) |
| `{params.NAME}` | a `NAME=value` word of the directive |

Filters run left to right: `{output|trim|quote}`.

| Filter | Does |
| --- | --- |
| `trim` | strips surrounding whitespace |
| `quote`, `quote:<prefix>` | prefixes every line with `> ` (or `<prefix>`) |
| `indent`, `indent:<n or text>` | indents every non-empty line by 2 spaces (or `n` spaces, or `text`) |
| `code`, `code:<lang>` | wraps it in a fenced code block of `lang=` (or `<lang>`) |
| `first`, `last`, `lines` | the first line, the last line, the number of lines |
| `upper`, `lower` | changes case |
| `json`, `html` | JSON string literal; html-escaped |
| `default:<text>` | `<text>` when empty; also makes an unset `{params.x}` or `{env.X}` optional |

`{{` and `}}` are literal braces. An unknown placeholder or filter, or an unset `{params.x}` without `|default`, fails the directive with an error saying which.

## Formatters

A formatter is a function from the directive's context to the text that's written. In `region` mode that's the whole region, so it can add anything around the output: quotes, a code block for the command and another for its output, a caption, ... Import the types and helpers from `cmdsync` (installed as a dev dependency) to write it with completions and checks:

```ts
// scripts/terminal.ts
import { defineFormatter, fence } from 'cmdsync';

export default defineFormatter(ctx => [
  ...ctx.params.caption ? [`*${ctx.params.caption}*`, ''] : [],
  fence(ctx.input, ctx.lang ?? 'sh'),
  '',
  fence(ctx.output, 'txt'),
].join('\n'));
```

`ctx` (`FormatterContext`) is:

| Field | Value |
| --- | --- |
| `output` | the command's output (after `format=`) |
| `input` | the command as written in the directive |
| `name`, `mode`, `lang` | the custom directive's name, its base mode, and `lang=` (or the directive's default) |
| `params` | the directive's `key=value` words |
| `file`, `line` | the file with the directive (absolute), and the directive's line (1-based) |
| `config` | the resolved config |

Helpers to import from `cmdsync`: `fence(text, lang?)` (a fenced block, with a fence longer than any inside), `quote(text, prefix?)`, `indent(text, by?)`, and `renderTemplate(template, vars)` with `templateVars(ctx)` to fill a template string with the directive's placeholders.

It runs synchronously and must return a string; if it throws, the directive fails with that message and keeps its content. `.ts` formatters run with Node's built-in type stripping (Node `>=22.18`), so they can't use TypeScript-only syntax like `enum`. `cmdsync lint` reports formatters that fail to load, without running anything.

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/custom-directives.md -->
---

[← Directives](directives.md) · [Contents](README.md) · [CLI →](cli.md)
<!-- CMDSYNC end -->
