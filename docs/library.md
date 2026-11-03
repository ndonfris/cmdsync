# Using it as a library

Everything the CLI does is exported, with types, so another tool can run cmdsync, or just its pieces:

```ts
import { loadFormatters, renderTemplate, resolveConfig, run, unifiedDiff, updateRegions } from 'cmdsync';

// whole run, the same as the CLI
const results = run(resolveConfig({ cwd: process.cwd() }), { write: false });

// `cmdsync lint`: each file's results say what every directive resolved to, and which lines are stray
const linted = run(resolveConfig({ cwd: process.cwd() }), { lint: true });

// `--diff`
const patch = results.map(r => unifiedDiff(r.original, r.content, { path: r.file })).join('');

// custom directives with formatters: load them first (it's async), then run
const config = resolveConfig({ cwd: process.cwd() });
const withFormatters = run(config, { formatters: await loadFormatters(config) });

// pure transform with your own command runner
const syntax = { open: '<!--', close: '-->', fences: true, marker: 'CMDSYNC', endMarker: 'CMDSYNC end' };
const { content, results: regions } = updateRegions(markdown, syntax, cmd => ({
  output: `ran ${cmd}`,
  status: 0,
}));

// the template engine on its own
renderTemplate('{output|trim|quote}', { output: 'hello\n' }); // '> hello'
```

The main pieces:

| Export | What it is |
| --- | --- |
| `resolveConfig`, `findConfig`, `validateConfig` | config loading (with `defaults` for a global config) |
| `run`, `processFile`, `collectFiles` | a whole run, one file, or the files a config includes |
| `updateRegions`, `findDirectives` | the scanner, as a pure text transform |
| `loadFormatters`, `renderTemplate`, `templateVars`, `defineFormatter`, `Formatter`, `FormatterContext`, `fence`, `quote`, `indent` | custom directives |
| `formatOutput`, `mdTable`, `htmlTable` | the `format=` table renderers |
| `unifiedDiff`, `diffLines` | `--diff` |
| `planMigration`, `migrateDirectives` | `cmdsync migrate` |
| `loadGlobalConfig`, `selectRepos` | the global config and `--all`/`--group`/`--repo` |

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/library.md -->
---

[← Generating docs from your source code](generating-docs.md) · [Contents](README.md) · [Migrating from `update-codeblocks` →](migrating.md)
<!-- CMDSYNC end -->
