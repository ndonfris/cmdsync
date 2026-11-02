/**
 * Prints every diagnostic code from `src/error-codes.ts` as JSON rows, for
 * cmdsync's `format=md-table` / `format=html-table`:
 *
 *   <!-- CMDSYNC region format=md-table: tsx scripts/error-codes.ts --links -->
 *   <!-- /CMDSYNC -->
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
