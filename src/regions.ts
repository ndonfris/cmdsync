/**
 * Pure text transforms: find `<!-- MARKER [mode] [start] [key=value ...]: command -->`
 * directives (in any comment syntax) and replace what they point at with the
 * command's output.
 *
 *   region     `<!-- MARKER region start: cmd -->` ... lines ... `<!-- MARKER end -->`
 *              (`MARKER start:` is short for `MARKER region start:`)
 *   line       `<!-- MARKER line: cmd -->` then the single line it replaces
 *   codeblock  `<!-- MARKER codeblock: cmd -->` then a fenced code block (markdown only)
 *   inline     `<!-- MARKER region start: cmd -->text<!-- MARKER end -->` on one line
 *
 * Without a mode, a markdown directive followed by a fenced code block is a
 * codeblock, one with its end marker on the same line is inline, and anything
 * else is a region.
 */
import { type Format, formatOutput, isFormat } from './format.js';
import type { RegionSyntax } from './syntax.js';

export const MODES = ['region', 'line', 'codeblock'] as const;
export type Mode = typeof MODES[number];

const isMode = (value: string): value is Mode => (MODES as readonly string[]).includes(value);

export interface Directive {
  /** 0-based line index of the start comment */
  line: number;
  command: string;
  /** `MARKER mode start key=value ...: command` */
  options: { mode?: Mode; start?: true; format?: Format; };
}

export interface CommandResult {
  output: string;
  status: number;
  /** Set when the command never ran (e.g. rejected by the `commands` allowlist) */
  error?: string;
}

export type RegionResult =
  | { directive: Directive; kind: 'updated'; changed: boolean; }
  | { directive: Directive; kind: 'failed'; result: CommandResult; }
  | { directive: Directive; kind: 'invalid'; reason: string; };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const closeOrEol = (syntax: RegionSyntax) => syntax.close ? escapeRegExp(syntax.close) : '$';

/** Marker text with any run of spaces matching any whitespace (`CMDSYNC end`) */
const markerPattern = (marker: string) => marker.trim().split(/\s+/).map(escapeRegExp).join('\\s+');

/** Only words and `key=value` between the marker and the colon, so `<!-- MARKER end -->` is never a start */
export const startPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.marker)}((?:\\s+[\\w.=-]+)*)\\s*:\\s*(.+?)\\s*${closeOrEol(syntax)}`, 'g');

export const endPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.endMarker)}\\s*${closeOrEol(syntax)}`);

const openingFence = (line: string) => line.match(/^(\s*)(`{3,}|~{3,})/);

/** A closing fence uses the same character, is at least as long, and has nothing after it */
const isClosingFence = (line: string, fence: string) => {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1];
  return !!match && match[0] === fence[0] && match.length >= fence.length;
};

/** Index of the line closing the fence opened at `open`, or -1 when unterminated */
const closingFence = (lines: string[], open: number, fence: string) => {
  for (let i = open + 1; i < lines.length; i++) if (isClosingFence(lines[i]!, fence)) return i;
  return -1;
};

/** [start, end) ranges of inline code spans, where directives are only examples */
const codeSpans = (line: string) =>
  [...line.matchAll(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g)].map(m => [m.index, m.index + m[0].length] as const);

/** `region start format=md-table` (or `start format=md-table`) → `{ mode: 'region', start: true, format: 'md-table' }`, or an error message */
function parseOptions(raw: string | undefined): Directive['options'] | string {
  const options: Directive['options'] = {};
  const words = raw?.split(/\s+/).filter(Boolean) ?? [];
  if (words[0] && !words[0].includes('=') && words[0] !== 'start') {
    const mode = words.shift()!;
    if (!isMode(mode)) return `unknown mode "${mode}" (expected ${MODES.join(', ')})`;
    options.mode = mode;
  }
  if (words[0] === 'start') {
    words.shift();
    if (options.mode === 'line' || options.mode === 'codeblock') {
      return `\`${options.mode}\` directives have no end marker, so they don't take \`start\``;
    }
    options.start = true;
    // `start` alone is short for `region start`
    options.mode ??= 'region';
  }
  for (const word of words) {
    const [key, value = ''] = word.split('=');
    if (key !== 'format') return `unknown option "${word}"`;
    if (!isFormat(value)) return `unknown format "${value}"`;
    options.format = value;
  }
  return options;
}

/** Directives on one line, in order (outside of inline code in markdown) */
export function lineDirectives(text: string, line: number, syntax: RegionSyntax) {
  const spans = syntax.fences ? codeSpans(text) : [];
  return [...text.matchAll(startPattern(syntax))]
    .filter(m => !spans.some(([start, end]) => m.index >= start && m.index < end))
    .map(m => ({ match: m, line, command: m[2]!, options: parseOptions(m[1]) }));
}

/** Every directive in `content`, skipping fenced code blocks in markdown */
export function findDirectives(content: string, syntax: RegionSyntax): Directive[] {
  const lines = content.split('\n');
  const found: Directive[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = syntax.fences && openingFence(lines[i]!);
    if (fence) {
      const close = closingFence(lines, i, fence[2]!);
      i = close === -1 ? lines.length : close;
      continue;
    }
    for (const { line, command, options } of lineDirectives(lines[i]!, i, syntax)) {
      found.push({ line, command, options: typeof options === 'string' ? {} : options });
    }
  }
  return found;
}

const indent = (text: string, prefix: string) => prefix ? text.replace(/^(?=.)/gm, prefix) : text;

/**
 * Rewrite every directive's region using `run`. Failed commands and invalid
 * directives (no end marker, unknown option, ...) leave their region untouched.
 */
export function updateRegions(
  content: string,
  syntax: RegionSyntax,
  run: (command: string) => CommandResult,
): { content: string; results: RegionResult[]; } {
  const lines = content.split('\n');
  const output: string[] = [];
  const results: RegionResult[] = [];
  const end = endPattern(syntax);

  /** Command output for a directive, formatted; undefined (and a result recorded) on failure */
  const generate = (directive: Directive, options: Directive['options'] | string): string | undefined => {
    if (typeof options === 'string') {
      results.push({ directive, kind: 'invalid', reason: options });
      return undefined;
    }
    const result = run(directive.command);
    if (result.status !== 0 || result.error) {
      results.push({ directive, kind: 'failed', result });
      return undefined;
    }
    try {
      return options.format ? formatOutput(result.output, options.format) : result.output;
    } catch (err) {
      results.push({ directive, kind: 'failed', result: { ...result, error: (err as Error).message } });
      return undefined;
    }
  };

  /** Rewrite inline regions on one line; returns the directive left open at the end of the line, if any */
  const inline = (text: string, line: number) => {
    let rewritten = '';
    let rest = text;
    let consumed = 0;
    for (const { match, command, options } of lineDirectives(text, line, syntax)) {
      // a start comment inside the previous inline region is old content, not a directive
      if (match.index < consumed) continue;
      const directive: Directive = { line, command, options: typeof options === 'string' ? {} : options };
      const afterStart = match.index + match[0].length - consumed;
      const mode = directive.options.mode;
      const close = mode === 'line' || mode === 'codeblock' ? null : end.exec(rest.slice(afterStart));
      if (!close) return { text: rewritten + rest, open: { directive, options } };
      const previous = rest.slice(afterStart, afterStart + close.index);
      const next = generate(directive, options)?.trim();
      if (next !== undefined) results.push({ directive, kind: 'updated', changed: previous !== next });
      const length = afterStart + close.index + close[0].length;
      rewritten += rest.slice(0, afterStart) + (next ?? previous) + close[0];
      rest = rest.slice(length);
      consumed += length;
    }
    return { text: rewritten + rest, open: undefined };
  };

  let i = 0;
  while (i < lines.length) {
    const fence = syntax.fences && openingFence(lines[i]!);
    if (fence) {
      const close = closingFence(lines, i, fence[2]!);
      const last = close === -1 ? lines.length - 1 : close;
      output.push(...lines.slice(i, last + 1));
      i = last + 1;
      continue;
    }

    const { text, open } = inline(lines[i]!, i);
    output.push(text);
    i++;
    if (!open) continue;
    const { directive, options } = open;
    const { mode } = directive.options;
    const invalid = (reason: string) => results.push({ directive, kind: 'invalid', reason });
    // a bad mode or option is the real problem, not whatever the fallback mode would complain about
    if (typeof options === 'string') {
      invalid(options);
      continue;
    }

    // line: replace exactly the next line with exactly one line of output
    if (mode === 'line') {
      const target = lines[i];
      if (target === undefined) {
        invalid('no line follows the directive');
        continue;
      }
      if (lineDirectives(target, i, syntax).length > 0 || end.test(target) || (syntax.fences && openingFence(target))) {
        invalid('the line after a `line` directive must be plain content, not a directive, end marker or code fence');
        continue;
      }
      const body = generate(directive, options)?.replace(/\s+$/, '');
      if (body === undefined) continue;
      if (body.includes('\n')) {
        results.push({
          directive,
          kind: 'failed',
          result: { output: body, status: 0, error: `\`line\` mode expects one line of output, got ${body.split('\n').length}` },
        });
        continue;
      }
      const replacement = body === '' ? '' : lines[directive.line]!.match(/^\s*/)![0] + body.trimStart();
      output.push(replacement);
      results.push({ directive, kind: 'updated', changed: target !== replacement });
      i++;
      continue;
    }

    if (mode === 'codeblock' && !syntax.fences) {
      invalid('`codeblock` mode only works in markdown files (or a `syntax` rule with `"fences": true`)');
      continue;
    }

    // codeblock: only blank lines between the directive and an opening fence
    let next = i;
    while (syntax.fences && mode !== 'region' && next < lines.length && lines[next]!.trim() === '') next++;
    const codeFence = syntax.fences && mode !== 'region' && next < lines.length && openingFence(lines[next]!);
    if (mode === 'codeblock' && !codeFence) {
      invalid('expected a fenced code block after the directive (only blank lines may come between)');
      continue;
    }
    if (codeFence) {
      const close = closingFence(lines, next, codeFence[2]!);
      if (close === -1) {
        results.push({ directive, kind: 'invalid', reason: 'the fenced code block after the directive is never closed' });
        continue;
      }
      const body = generate(directive, options)?.replace(/\s+$/, '');
      if (body === undefined) continue;
      const previous = lines.slice(next + 1, close).join('\n');
      const replacement = indent(body, codeFence[1]!);
      output.push(...lines.slice(i, next + 1));
      if (replacement !== '') output.push(replacement);
      output.push(lines[close]!);
      results.push({ directive, kind: 'updated', changed: previous !== replacement });
      i = close + 1;
      continue;
    }

    // region: everything up to the end marker, which must come before any other directive
    let stop = i;
    let found = false;
    for (; stop < lines.length; stop++) {
      const nested = syntax.fences && openingFence(lines[stop]!);
      if (nested) {
        const close = closingFence(lines, stop, nested[2]!);
        stop = close === -1 ? lines.length : close;
      } else if (lineDirectives(lines[stop]!, stop, syntax).length > 0) {
        break;
      } else if (end.test(lines[stop]!)) {
        found = true;
        break;
      }
    }
    if (!found) {
      const expected = `${syntax.open} ${syntax.endMarker}${syntax.close ? ` ${syntax.close}` : ''}`;
      results.push({
        directive,
        kind: 'invalid',
        reason: syntax.fences && !mode
          ? `no end marker \`${expected}\` or fenced code block follows the directive`
          : `no end marker \`${expected}\` follows the directive`,
      });
      continue;
    }
    const body = generate(directive, options)?.replace(/\s+$/, '');
    if (body === undefined) continue;
    const previous = lines.slice(i, stop).join('\n');
    const replacement = indent(body, lines[directive.line]!.match(/^\s*/)![0]);
    if (replacement !== '') output.push(replacement);
    output.push(lines[stop]!);
    results.push({ directive, kind: 'updated', changed: previous !== replacement });
    i = stop + 1;
  }

  return { content: output.join('\n'), results };
}
