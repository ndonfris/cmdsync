/**
 * Built-in output formats, selected per directive: `<!-- CMDSYNC region start format=md-table: cmd -->`.
 * Each turns the command's stdout into the text written to the region.
 */

export const FORMATS = ['md-table', 'html-table'] as const;
export type Format = typeof FORMATS[number];

export const isFormat = (value: string): value is Format => (FORMATS as readonly string[]).includes(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cell = (value: unknown): string =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

/**
 * Header + rows from JSON: an array of objects (columns are the keys, in the
 * order first seen) or an array of arrays (the first row is the header).
 */
export function tableRows(json: string): string[][] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`table formats expect JSON output: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) throw new Error('table formats expect a JSON array');
  if (data.every(Array.isArray)) return data.map(row => row.map(cell));
  if (data.every(isObject)) {
    const columns = [...new Set(data.flatMap(Object.keys))];
    return data.length ? [columns, ...data.map(row => columns.map(c => cell(row[c])))] : [];
  }
  throw new Error('table formats expect an array of objects or an array of arrays');
}

export function mdTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const escaped = rows.map(row => row.map(c => c.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br />')));
  const count = Math.max(...escaped.map(row => row.length));
  const widths = Array.from({ length: count }, (_, i) => Math.max(3, ...escaped.map(row => row[i]?.length ?? 0)));
  // the last column isn't padded, so one long cell doesn't add trailing spaces to every row
  const last = count - 1;
  const format = (row: string[]) => `| ${widths.map((w, i) => i < last ? (row[i] ?? '').padEnd(w) : row[i] ?? '').join(' | ')} |`;
  const separator = widths.map((w, i) => '-'.repeat(i < last ? w : Math.max(3, escaped[0]![i]?.length ?? 0)));
  const [header, ...body] = escaped;
  return [format(header!), `| ${separator.join(' | ')} |`, ...body.map(format)].join('\n');
}

/** Braces are encoded too, so the table is also valid JSX inside `.mdx` */
const escapeHtml = (s: string) =>
  s.replace(/[&<>"{}]/g, c => `&#${c.charCodeAt(0)};`).replace(/\r?\n/g, '<br />');

export function htmlTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const tr = (row: string[], tag: 'th' | 'td') => `    <tr>${row.map(c => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`;
  const [header, ...body] = rows;
  return [
    '<table>',
    '  <thead>',
    tr(header!, 'th'),
    '  </thead>',
    '  <tbody>',
    ...body.map(row => tr(row, 'td')),
    '  </tbody>',
    '</table>',
  ].join('\n');
}

export function formatOutput(output: string, format: Format): string {
  switch (format) {
    case 'md-table':
      return mdTable(tableRows(output));
    case 'html-table':
      return htmlTable(tableRows(output));
  }
}
