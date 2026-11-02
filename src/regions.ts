/**
 * Pure text transforms: find `<!-- MARKER: command -->` directives (in any
 * comment syntax) and replace the region they delimit with the command's output.
 *
 *   block      `<!-- MARKER: cmd -->` ... lines ... `<!-- /MARKER -->`
 *   inline     `<!-- MARKER: cmd -->text<!-- /MARKER -->` on one line
 *   codeblock  `<!-- MARKER: cmd -->` followed by a fenced code block (markdown only)
 */
import { type Format, formatOutput, isFormat } from './format.js';
import type { RegionSyntax } from './syntax.js';

export interface Directive {
  /** 0-based line index of the start comment */
  line: number;
  command: string;
  /** `MARKER[key=value,...]: command` */
  options: { format?: Format; };
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

export const startPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${escapeRegExp(syntax.marker)}(?:\\[([^\\]]*)\\])?:\\s*(.+?)\\s*${closeOrEol(syntax)}`, 'g');

export const endPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${escapeRegExp(syntax.endMarker)}\\s*${closeOrEol(syntax)}`);

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

function parseOptions(raw: string | undefined): Directive['options'] | string {
  const options: Directive['options'] = {};
  for (const pair of raw?.split(',').map(s => s.trim()).filter(Boolean) ?? []) {
    const [key, value = ''] = pair.split('=').map(s => s.trim());
    if (key !== 'format') return `unknown option "${key}"`;
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
      const close = end.exec(rest.slice(afterStart));
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

    // codeblock: only blank lines between the directive and an opening fence
    let next = i;
    while (syntax.fences && next < lines.length && lines[next]!.trim() === '') next++;
    const codeFence = syntax.fences && next < lines.length && openingFence(lines[next]!);
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

    // block: everything up to the end marker, which must come before any other directive
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
        reason: syntax.fences
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
