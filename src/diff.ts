/** Line diffs for `--diff`: Myers' O(ND) algorithm, printed as a unified diff */

export type Edit = { op: ' ' | '-' | '+'; line: string; };

/** Shortest edit script turning `a` into `b`, as a list of kept, removed and added lines */
export function diffLines(a: string[], b: string[]): Edit[] {
  // the common prefix and suffix are kept as is, so only the changed middle is searched
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;

  const x0 = a.slice(start, endA);
  const y0 = b.slice(start, endB);
  const n = x0.length;
  const m = y0.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  search: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && x0[x] === y0[y]) x++, y++;
      v[offset + k] = x;
      if (x >= n && y >= m) break search;
    }
  }

  // walk the trace back from (n, m) to (0, 0)
  const middle: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) middle.push({ op: ' ', line: x0[--x]!}), y--;
    if (d > 0) {
      if (x === prevX) middle.push({ op: '+', line: y0[--y]! });
      else middle.push({ op: '-', line: x0[--x]! });
    }
  }
  middle.reverse();

  return [
    ...a.slice(0, start).map(line => ({ op: ' ' as const, line })),
    ...middle,
    ...a.slice(endA).map(line => ({ op: ' ' as const, line })),
  ];
}

/** Text as lines; a last line without a newline gets a `\0` suffix, so it never matches one with a newline */
const NO_EOL = '\0';
function toLines(text: string): string[] {
  if (text === '') return [];
  if (text.endsWith('\n')) return text.slice(0, -1).split('\n');
  const lines = text.split('\n');
  lines[lines.length - 1] += NO_EOL;
  return lines;
}

const COLORS = { '-': '\x1b[31m', '+': '\x1b[32m', '@': '\x1b[36m', file: '\x1b[1m', reset: '\x1b[0m' };

/** A unified diff of two texts (empty when they're equal), with `context` unchanged lines around each change */
export function unifiedDiff(
  before: string,
  after: string,
  { path = 'file', context = 3, color = false }: { path?: string; context?: number; color?: boolean; } = {},
): string {
  if (before === after) return '';
  const paint = (kind: keyof typeof COLORS, text: string) => color ? `${COLORS[kind]}${text}${COLORS.reset}` : text;
  const edits = diffLines(toLines(before), toLines(after));

  // line numbers (1-based) of each edit in the old and new text
  const positions: { a: number; b: number; }[] = [];
  let a = 1;
  let b = 1;
  for (const edit of edits) {
    positions.push({ a, b });
    if (edit.op !== '+') a++;
    if (edit.op !== '-') b++;
  }

  // group changes whose context overlaps into hunks
  const changed = edits.flatMap((e, i) => e.op === ' ' ? [] : [i]);
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(edits.length, i + context + 1);
    const last = hunks.at(-1);
    if (last && from <= last[1]) last[1] = to;
    else hunks.push([from, to]);
  }

  const out = [paint('file', `--- a/${path}`), paint('file', `+++ b/${path}`)];
  for (const [from, to] of hunks) {
    const slice = edits.slice(from, to);
    const oldCount = slice.filter(e => e.op !== '+').length;
    const newCount = slice.filter(e => e.op !== '-').length;
    // an empty side starts one line before its position, as in GNU diff
    const oldStart = oldCount ? positions[from]!.a : positions[from]!.a - 1;
    const newStart = newCount ? positions[from]!.b : positions[from]!.b - 1;
    out.push(paint('@', `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`));
    for (const e of slice) {
      const noEol = e.line.endsWith(NO_EOL);
      const line = noEol ? e.line.slice(0, -1) : e.line;
      out.push(e.op === ' ' ? ` ${line}` : paint(e.op, `${e.op}${line}`));
      if (noEol) out.push('\\ No newline at end of file');
    }
  }
  return `${out.join('\n')}\n`;
}
