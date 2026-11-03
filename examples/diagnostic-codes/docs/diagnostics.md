# Diagnostics

Every diagnostic `my-lsp` reports. This table is generated from `src/error-codes.ts` by `scripts/error-codes.ts`, so don't edit it by hand: run `cmdsync`.

<!-- CMDSYNC start format=md-table: tsx scripts/error-codes.ts --links -->
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

Without deprecated codes, as an html table:

<!-- CMDSYNC start format=html-table: tsx scripts/error-codes.ts --exclude-deprecated -->
<table>
  <thead>
    <tr><th>Code</th><th>Severity</th><th>Message</th></tr>
  </thead>
  <tbody>
    <tr><td>1001</td><td>Error</td><td>missing closing token</td></tr>
    <tr><td>1002</td><td>Error</td><td>extra closing token</td></tr>
    <tr><td>1003</td><td>Error</td><td>arrays are 1-indexed</td></tr>
    <tr><td>2001</td><td>Warning</td><td>variables are not expanded inside single quotes</td></tr>
    <tr><td>2002</td><td>Warning</td><td>wrapper function used where its | piped builtin works</td></tr>
    <tr><td>4004</td><td>Warning</td><td>unused local definition</td></tr>
    <tr><td>4006</td><td>Error</td><td>function is defined more than once in the same scope</td></tr>
    <tr><td>9999</td><td>Error</td><td>syntax error</td></tr>
  </tbody>
</table>
<!-- CMDSYNC end -->
