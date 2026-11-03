# Migrating from `update-codeblocks`

`cmdsync` was previously named `update-codeblocks`. `cmdsync migrate` converts a project, from the root of the repository:

```fish
cmdsync migrate --diff     # show every change, without writing
cmdsync migrate            # write them
cmdsync lint               # check the result
```

It:

- replaces `update-codeblocks.json` with `cmdsync.json`, or renames the `"update-codeblocks"` key in `package.json`, keeping the settings (`package.json` is edited in place, so its formatting stays)
- rewrites `<!-- UPDATE_CODEBLOCK: cmd -->` (or a custom `marker`) above a fenced block to `<!-- CMDSYNC codeblock: cmd -->`
- renames `update-codeblocks` in `package.json` scripts, and the action (`uses: ndonfris/cmdsync@master`) and CLI in `.github/workflows`
- converts directives in older cmdsync syntax: `<!-- CMDSYNC[format=md-table]: cmd -->` … `<!-- /CMDSYNC -->` becomes `<!-- CMDSYNC start format=md-table: cmd -->` … `<!-- CMDSYNC end -->`, and a mode-less `<!-- CMDSYNC: cmd -->` gets its mode (`start` or `codeblock`) written out
- with `--from <marker>` (repeatable), also converts directives of another marker, like another tool's or a custom `marker` you used: `cmdsync migrate --from DOCS` turns `<!-- DOCS: cmd -->` above a fenced block into `<!-- CMDSYNC codeblock: cmd -->`, and `<!-- DOCS: cmd -->` … `<!-- /DOCS -->` into `<!-- CMDSYNC start: cmd -->` … `<!-- CMDSYNC end -->`. Only files the config's `include` globs match are converted.
- lists what's left to do by hand, like swapping the `update-codeblocks` dependency for `cmdsync`, and directives it couldn't classify (no end marker or fenced block after them)

Examples in inline code and fenced code blocks are left alone, and running it again changes nothing. What changed, by hand:

| `update-codeblocks` | `cmdsync` |
| --- | --- |
| `update-codeblocks.json` / `"update-codeblocks"` key | `cmdsync.json` / `"cmdsync"` key |
| default marker `UPDATE_CODEBLOCK` | default marker `CMDSYNC` (or set `"marker": "UPDATE_CODEBLOCK"`) |
| `uses: ndonfris/fish-lsp/packages/update-codeblocks@master` | `uses: ndonfris/cmdsync@master` |
| directive with no code block: warning, exit `0` | invalid directive: error, exit `1` |
| `results[].blocks`, kind `missing-codeblock` | `results[].regions`, kind `invalid` |

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/migrating.md -->
---

[← Using it as a library](library.md) · [Contents](README.md) · [Development →](development.md)
<!-- CMDSYNC end -->
