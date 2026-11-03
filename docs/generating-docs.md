# Generating docs from your source code

A directive can run any script, so the most reliable docs import the values they describe straight from your source. [`examples/diagnostic-codes`](../examples/diagnostic-codes) is a language server whose diagnostics are defined in [`src/error-codes.ts`](../examples/diagnostic-codes/src/error-codes.ts):

```ts
const missingEnd = 1001;
// ...
const codes: { [k in CodeTypes]: CodeValueType } = {
  [missingEnd]: {
    severity: DiagnosticSeverity.Error,
    code: missingEnd,
    codeDescription: { href: 'https://example.com/docs/end' },
    source: 'my-lsp',
    message: 'missing closing token',
  },
  // ...
};

export const ErrorCodes = { missingEnd, /* ... */ codes };
```

A small script imports that module and prints one JSON row per code:

<!-- CMDSYNC codeblock lang=ts include=../examples/diagnostic-codes/scripts/error-codes.ts -->
```ts
/**
 * Prints every diagnostic code from `src/error-codes.ts` as JSON rows, for
 * cmdsync's `format=md-table` / `format=html-table`:
 *
 *   <!-- CMDSYNC start format=md-table: node scripts/error-codes.ts --links -->
 *   <!-- CMDSYNC end -->
 *
 * Importing the source (instead of hand-copying its values into the docs)
 * means a new entry in `ErrorCodes.codes` shows up in every table on the next
 * `cmdsync` run, and `cmdsync --check` fails CI until it does.
 *
 * Options:
 *   --links               link each code to its documentation (markdown only)
 *   --exclude-deprecated  leave out deprecated codes
 */
import { parseArgs } from 'node:util';
import { DiagnosticSeverity, ErrorCodes } from '../src/error-codes.ts';

const { values } = parseArgs({
  options: {
    links: { type: 'boolean', default: false },
    'exclude-deprecated': { type: 'boolean', default: false },
  },
});

const severityName = Object.fromEntries(Object.entries(DiagnosticSeverity).map(([name, value]) => [value, name]));

const rows = Object.values(ErrorCodes.codes)
  .filter(c => !(values['exclude-deprecated'] && c.isDeprecated))
  .sort((a, b) => a.code - b.code)
  .map(c => ({
    Code: values.links ? `[\`${c.code}\`](${c.codeDescription.href})` : String(c.code),
    Severity: severityName[c.severity],
    Message: c.isDeprecated ? `${c.message} (deprecated)` : c.message,
  }));

console.log(JSON.stringify(rows, null, 2));
```

The docs then hold a region with `format=md-table` (or `format=html-table`, for `.mdx`):

````markdown
<!-- CMDSYNC start format=md-table: node scripts/error-codes.ts --links -->
<!-- CMDSYNC end -->
````

Running `cmdsync` fills it in:

<!-- CMDSYNC start format=md-table: node examples/diagnostic-codes/scripts/error-codes.ts --links -->
| Code                                               | Severity    | Message |
| -------------------------------------------------- | ----------- | ------- |
| [`1001`](https://example.com/docs/end)             | Error       | missing closing token |
| [`1002`](https://example.com/docs/end)             | Error       | extra closing token |
| [`1003`](https://example.com/docs/arrays#index)    | Error       | arrays are 1-indexed |
| [`2001`](https://example.com/docs/quotes)          | Warning     | variables are not expanded inside single quotes |
| [`2002`](https://example.com/docs/functions#wraps) | Warning     | wrapper function used where its \| piped builtin works |
| [`4004`](https://example.com/docs/scope)           | Warning     | unused local definition |
| [`4006`](https://example.com/docs/functions)       | Error       | function is defined more than once in the same scope |
| [`6001`](https://example.com/docs/env)             | Information | MY_LSP_LOG is renamed to MY_LSP_LOG_FILE (deprecated) |
| [`9999`](https://example.com/docs/syntax)          | Error       | syntax error |
<!-- CMDSYNC end -->

Add a code to `ErrorCodes.codes` and the next `cmdsync` run adds its row to every table. Until it's run, `cmdsync --check` in CI (or [`--staged` in a pre-commit hook](git-hooks.md)) catches the stale docs. The generated files are [`docs/diagnostics.md`](../examples/diagnostic-codes/docs/diagnostics.md) and [`docs/diagnostics.mdx`](../examples/diagnostic-codes/docs/diagnostics.mdx). Regenerate them with `yarn docs:examples`.

Notes for your own scripts:

- Node (`>=22.18`) runs a TypeScript script directly, `node scripts/error-codes.ts`, so nothing has to be built first, as long as the script and what it imports only use TypeScript that can be stripped (no `enum` or `namespace`; otherwise run it with [tsx](https://tsx.is)). List `node` in [`commands`](configuration.md#recognized-commands) if you use an allowlist.
- Keep the script free of side effects beyond printing: print JSON for the table formats, or the finished markdown/html when you need full control (a non-JSON format, grouping, headings per category).
- Sort the rows yourself (by code above), so the output, and therefore the diff, is stable.
- If the source imports runtime packages (a real `error-codes.ts` imports `DiagnosticSeverity` from `vscode-languageserver`), the project's dependencies must be installed wherever cmdsync runs.

## Using it from other repositories

Docs in other repositories (B, C) don't have A's source. Two ways to keep their tables in sync, both of which work with the [release workflow](github-actions.md#updating-other-repositories-on-release) below:

1. **Ship the data with A.** Add the script's output to A's CLI (e.g. `A info --diagnostics --json`). B and C then only need the released binary, which their `install` config pins to the released version:

   ```markdown
   <!-- CMDSYNC start format=md-table: A info --diagnostics --json -->
   <!-- CMDSYNC end -->
   ```

2. **Check out A's source at the released tag** in the workflow's `setup`, and run the script from there:

   ```yaml
   with:
     setup: |
       git clone --depth 1 --branch "$UPSTREAM_VERSION" https://github.com/your-org/A ../A
       (cd ../A && yarn install --frozen-lockfile)
   ```

   ```markdown
   <!-- CMDSYNC start format=md-table: node ../A/scripts/error-codes.ts --links -->
   <!-- CMDSYNC end -->
   ```

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/generating-docs.md -->
---

[← GitHub Actions](github-actions.md) · [Contents](README.md) · [Using it as a library →](library.md)
<!-- CMDSYNC end -->
