/**
 * Pure text transforms: find `<!-- MARKER [mode] [start] [key=value ...]: command -->`
 * directives (in any comment syntax) and replace what they point at with the
 * command's output.
 *
 *   region     `<!-- MARKER start: cmd -->` ... lines ... `<!-- MARKER end -->`
 *              (`MARKER start:` is short for `MARKER region start:`)
 *   line       `<!-- MARKER line: cmd -->` then the single line it replaces
 *   codeblock  `<!-- MARKER codeblock: cmd -->` then a fenced code block (markdown only);
 *              `codeblock lang=fish` also sets the fence's language, creating the block if missing
 *   inline     `<!-- MARKER start: cmd -->text<!-- MARKER end -->` on one line
 *   console    `<!-- MARKER console: cmd -->` then a ```console block: `$ cmd` and its output (markdown only)
 *   console-pretty  `<!-- MARKER console-pretty lang=fish: cmd -->` then two blocks: the
 *              command (```fish, default ```sh) and its output (```txt) (markdown only)
 *
 * `include=path#L10-L20` in place of `: cmd` takes the content from a file
 * (relative to the file with the directive) instead of a command.
 *
 * Without a mode, a markdown directive followed by a fenced code block is a
 * codeblock, one with its end marker on the same line is inline, and anything
 * else is a region.
 */
import { BASE_MODES, type CustomDirective } from './config.ts';
import { type Format, formatOutput, isFormat } from './format.ts';
import type { RegionSyntax } from './syntax.ts';

export const MODES = BASE_MODES;
export type Mode = typeof MODES[number];

/** Modes that replace what follows the directive, so they have no end marker */
const NO_END: readonly Mode[] = ['line', 'codeblock', 'console', 'console-pretty'];
/** Modes that replace (or create) fenced code blocks, so they take `lang=` */
const FENCED: readonly Mode[] = ['codeblock', 'console', 'console-pretty'];
const isConsole = (mode: Mode | undefined) => mode === 'console' || mode === 'console-pretty';

const isMode = (value: string): value is Mode => (MODES as readonly string[]).includes(value);

/** `include=docs/a.ts#L10-L20`: 1-based, inclusive line range */
export interface Include {
  spec: string;
  path: string;
  from?: number;
  to?: number;
}

export interface Directive {
  /** 0-based line index of the start comment */
  line: number;
  /** Empty for `include=` directives */
  command: string;
  /** `MARKER mode start key=value ...: command` */
  options: {
    mode?: Mode;
    start?: true;
    format?: Format;
    lang?: string;
    include?: Include;
    /** Name of the config's custom directive this is */
    custom?: string;
    /** Other `key=value` words of a custom directive, for its formatter and template */
    params?: Record<string, string>;
  };
}

/** What a directive's content comes from: its command, or `include=...` */
export const directiveSource = (d: Directive) => d.command || (d.options.include ? `include=${d.options.include.spec}` : '');

export interface CommandResult {
  output: string;
  status: number;
  /** Set when the command never ran (e.g. rejected by the `commands` allowlist) */
  error?: string;
}

/** How a directive was applied, after inferring its mode */
export type Applied = Mode | 'inline';

export type RegionResult =
  /** `end`: 0-based index of the region's last line (end marker, closing fence, or the replaced line) */
  /** `command`: what ran (a custom directive's `command` filled in), empty for `include=` */
  | { directive: Directive; kind: 'updated'; changed: boolean; as: Applied; end: number; command: string; }
  | { directive: Directive; kind: 'failed'; result: CommandResult; }
  | { directive: Directive; kind: 'invalid'; reason: string; };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const closeOrEol = (syntax: RegionSyntax) => syntax.close ? escapeRegExp(syntax.close) : '$';

/** Marker text with any run of spaces matching any whitespace (`CMDSYNC end`) */
const markerPattern = (marker: string) => marker.trim().split(/\s+/).map(escapeRegExp).join('\\s+');

/**
 * Only words and `key=value` between the marker and the optional `: command`.
 * Without a command it's only a directive when it has `include=` (see `lineDirectives`),
 * so `<!-- MARKER end -->` is never a start.
 */
export const startPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.marker)}((?:\\s+[\\w.=+#/@~-]+)*)\\s*(?::\\s*(.+?))?\\s*${closeOrEol(syntax)}`, 'g');

/** Where the marker appears as a comment at all: directives, end markers, and typos of either */
const markerMention = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.marker)}(?![\\w-])`, 'g');

export const endPattern = (syntax: RegionSyntax) =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.endMarker)}\\s*${closeOrEol(syntax)}`);

/**
 * A fence opening a code block: \`\`\` or ~~~, indented or inside a blockquote (`> \`\`\``).
 * The prefix (group 1) is what the block's lines start with, so a replaced body keeps it.
 */
export const openingFence = (line: string) => line.match(/^((?:\s*>)*\s*)(`{3,}|~{3,})(.*)$/);

/** A backtick fence longer than any fence-like line in `body`, so the body can't close it */
const fenceFor = (body: string) =>
  '`'.repeat(Math.max(3, ...[...body.matchAll(/^\s*(`{3,})/gm)].map(m => m[1]!.length + 1)));

/** A closing fence uses the same character, is at least as long, and has nothing after it */
const isClosingFence = (line: string, fence: string) => {
  const match = line.match(/^(?:\s*>)*\s*(`{3,}|~{3,})\s*$/)?.[1];
  return !!match && match[0] === fence[0] && match.length >= fence.length;
};

/** Index of the line closing the fence opened at `open`, or -1 when unterminated */
export const closingFence = (lines: string[], open: number, fence: string) => {
  for (let i = open + 1; i < lines.length; i++) if (isClosingFence(lines[i]!, fence)) return i;
  return -1;
};

/** [start, end) ranges of inline code spans, where directives are only examples */
export const codeSpans = (line: string) =>
  [...line.matchAll(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g)].map(m => [m.index, m.index + m[0].length] as const);

/** `docs/a.ts#L10-L20` → `{ path: 'docs/a.ts', from: 10, to: 20 }` (also `#L10`, `#L10-20`, `#L10-`) */
function parseInclude(spec: string): Include | string {
  const match = spec.match(/^(.+?)(?:#L(\d+)(?:(-)L?(\d*))?)?$/);
  if (!match) return `invalid include "${spec}"`;
  const [, path, from, dash, to] = match;
  if (from === undefined) return { spec, path: path! };
  const range: Include = { spec, path: path!, from: Number(from), to: dash ? (to ? Number(to) : undefined) : Number(from) };
  if (range.from! < 1 || (range.to !== undefined && range.to < range.from!)) return `invalid line range in include "${spec}"`;
  return range;
}

/** `region start format=md-table` (or `start format=md-table`) → `{ mode: 'region', start: true, format: 'md-table' }`, or an error message */
function parseOptions(raw: string | undefined, directives: Record<string, CustomDirective> = {}): Directive['options'] | string {
  const options: Directive['options'] = {};
  const words = raw?.split(/\s+/).filter(Boolean) ?? [];
  let custom: CustomDirective | undefined;
  if (words[0] && !words[0].includes('=') && words[0] !== 'start') {
    const mode = words.shift()!;
    custom = Object.hasOwn(directives, mode) ? directives[mode] : undefined;
    if (custom) {
      options.custom = mode;
      options.mode = custom.mode ?? 'region';
    } else if (isMode(mode)) {
      options.mode = mode;
    } else {
      const names = [...MODES, ...Object.keys(directives)];
      return `unknown mode "${mode}" (expected ${names.join(', ')})`;
    }
  }
  if (words[0] === 'start') {
    words.shift();
    if (options.mode && NO_END.includes(options.mode)) {
      return `\`${options.mode}\` directives have no end marker, so they don't take \`start\``;
    }
    options.start = true;
    // `start` alone is short for `region start`
    options.mode ??= 'region';
  }
  for (const word of words) {
    const [key, value = ''] = word.split('=');
    if (key === 'format') {
      if (!isFormat(value)) return `unknown format "${value}"`;
      options.format = value;
    } else if (key === 'lang') {
      // a custom directive passes it on to its formatter and template, whatever its mode
      if (!custom && (!options.mode || !FENCED.includes(options.mode))) return `\`lang\` only applies to ${FENCED.map(m => `\`${m}\``).join(', ')} directives`;
      if (!/^[\w.+#-]+$/.test(value)) return `invalid lang "${value}"`;
      options.lang = value;
    } else if (key === 'include') {
      const include = parseInclude(word.slice('include='.length));
      if (typeof include === 'string') return include;
      options.include = include;
    } else if (custom && /^[\w-]+$/.test(key!) && word.includes('=')) {
      (options.params ??= {})[key!] = word.slice(key!.length + 1);
    } else {
      return `unknown option "${word}"`;
    }
  }
  if (custom) {
    if (options.lang === undefined && custom.lang !== undefined && FENCED.includes(options.mode!)) options.lang = custom.lang;
    if (options.format === undefined && custom.format !== undefined) options.format = custom.format;
  }
  if (isConsole(options.mode) && (options.include || options.format)) {
    return `\`${options.mode}\` shows the command and its output as is, so it doesn't take \`${options.include ? 'include' : 'format'}=\``;
  }
  return options;
}

/** Directives on one line, in order (outside of inline code in markdown) */
export function lineDirectives(text: string, line: number, syntax: RegionSyntax) {
  const spans = syntax.fences ? codeSpans(text) : [];
  return [...text.matchAll(startPattern(syntax))]
    .filter(m => !spans.some(([start, end]) => m.index >= start && m.index < end))
    .filter(m => m[2] !== undefined || /(^|\s)include=/.test(m[1] ?? ''))
    .map(m => {
      const options = parseOptions(m[1], syntax.directives);
      const command = m[2] ?? '';
      const conflict = typeof options !== 'string' && !!options.include === !!command;
      return {
        match: m,
        line,
        command,
        options: conflict ? '`include=` replaces the command, so use one or the other' : options,
      };
    });
}

/** Mentions of the marker on a line (start or end comments, or typos of either), outside of inline code in markdown */
function markerMentions(text: string, syntax: RegionSyntax): number {
  const spans = syntax.fences ? codeSpans(text) : [];
  return [...text.matchAll(markerMention(syntax))].filter(m => !spans.some(([start, stop]) => m.index >= start && m.index < stop)).length;
}

/** Every directive in `content`, skipping fenced code blocks in markdown */
/** `<!-- MARKER ignore start -->` and `<!-- MARKER ignore end -->`, in the file's comment syntax */
const ignorePattern = (syntax: RegionSyntax, which: 'start' | 'end') =>
  new RegExp(`${escapeRegExp(syntax.open)}\\s*${markerPattern(syntax.marker)}\\s+ignore\\s+${which}\\s*${closeOrEol(syntax)}`);

/** Whether `pattern` matches `line` outside of inline code (in markdown) */
const mentions = (line: string, pattern: RegExp, syntax: RegionSyntax) => {
  const spans = syntax.fences ? codeSpans(line) : [];
  const m = pattern.exec(line);
  return !!m && !spans.some(([a, b]) => m.index >= a && m.index < b);
};

/**
 * When line `i` starts an ignored range (`MARKER ignore start`), the index of the line
 * that ends it (`MARKER ignore end`, which may be the same line), or -1 when nothing ends
 * it; `undefined` when line `i` isn't an ignore start. Fenced blocks inside the range are
 * skipped, so an example of `ignore end` in one doesn't end it.
 */
export function ignoredRange(lines: string[], i: number, syntax: RegionSyntax): number | undefined {
  const start = ignorePattern(syntax, 'start');
  const end = ignorePattern(syntax, 'end');
  const line = lines[i]!;
  if (!mentions(line, start, syntax)) return undefined;
  if (mentions(line.slice(start.exec(line)!.index), end, syntax)) return i;
  for (let j = i + 1; j < lines.length; j++) {
    const fence = syntax.fences && openingFence(lines[j]!);
    if (fence) {
      const close = closingFence(lines, j, fence[2]!);
      if (close === -1) return -1;
      j = close;
    } else if (mentions(lines[j]!, end, syntax)) {
      return j;
    }
  }
  return -1;
}

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
    const ignored = ignoredRange(lines, i, syntax);
    if (ignored !== undefined) {
      i = ignored === -1 ? lines.length : ignored;
      continue;
    }
    for (const { line, command, options } of lineDirectives(lines[i]!, i, syntax)) {
      found.push({ line, command, options: typeof options === 'string' ? {} : options });
    }
  }
  return found;
}

/** Prefix every non-empty line; inside a blockquote, blank lines keep their `>` so the quote doesn't end */
const indent = (text: string, prefix: string) => {
  if (!prefix) return text;
  if (!prefix.includes('>')) return text.replace(/^(?=.)/gm, prefix);
  return text.split('\n').map(line => line ? `${prefix}${line}` : prefix.trimEnd()).join('\n');
};

/** Remove the indentation every non-blank line shares */
const dedent = (text: string) => {
  const widths = text.split('\n').filter(l => l.trim()).map(l => l.match(/^[ \t]*/)![0].length);
  const width = Math.min(...widths);
  return widths.length && width ? text.replace(new RegExp(`^[ \\t]{0,${width}}`, 'gm'), '') : text;
};

/** The lines of `content` an include asks for, dedented when it's a range */
export function includeLines(content: string, include: Include): string {
  if (include.from === undefined) return content;
  const lines = content.replace(/\n$/, '').split('\n');
  if (include.from > lines.length || (include.to ?? 0) > lines.length) {
    throw new Error(`${include.spec} is past the end of ${include.path} (${lines.length} lines)`);
  }
  return dedent(lines.slice(include.from - 1, include.to ?? lines.length).join('\n'));
}

export interface UpdateOptions {
  /** Contents of an `include=` path (resolved by the caller, usually relative to the file) */
  read?: (path: string) => CommandResult;
  /**
   * Validate without generating: `run` is a check that returns an error or
   * succeeds, includes are read and range-checked, output isn't formatted, and
   * every region is reported as unchanged.
   */
  lint?: boolean;
  /**
   * For custom directives: the command to run (from the directive's `command`), and
   * what to write for its output (its `formatter` and `template`). Throws to fail the directive.
   */
  custom?: {
    command: (directive: Directive) => string;
    transform: (directive: Directive, output: string, command: string) => string;
  };
}

/**
 * Rewrite every directive's region using `run`. Failed commands and invalid
 * directives (no end marker, unknown option, ...) leave their region untouched.
 */
export function updateRegions(
  content: string,
  syntax: RegionSyntax,
  run: (command: string) => CommandResult,
  { read, lint = false, custom }: UpdateOptions = {},
): { content: string; results: RegionResult[]; stray: number[]; } {
  const lines = content.split('\n');
  const output: string[] = [];
  const results: RegionResult[] = [];
  /** 0-based lines that mention the marker without being a directive or an end marker */
  const stray: number[] = [];
  const end = endPattern(syntax);
  /** The command each directive ran, for its result */
  const ran = new Map<Directive, string>();
  const updated = (directive: Directive, changed: boolean, as: Applied, last: number) =>
    results.push({ directive, kind: 'updated', changed: changed && !lint, as, end: last, command: ran.get(directive) ?? '' });

  /** Command output for a directive, formatted; undefined (and a result recorded) on failure */
  const generate = (directive: Directive, options: Directive['options'] | string): string | undefined => {
    if (typeof options === 'string') {
      results.push({ directive, kind: 'invalid', reason: options });
      return undefined;
    }
    const { include } = options;
    const isCustom = options.custom !== undefined;
    if (isCustom && !custom) {
      results.push({ directive, kind: 'invalid', reason: `custom directive "${options.custom}" can't run here` });
      return undefined;
    }
    let command = directive.command;
    try {
      if (isCustom) command = custom!.command(directive);
    } catch (err) {
      results.push({ directive, kind: 'invalid', reason: (err as Error).message });
      return undefined;
    }
    if (!include) ran.set(directive, command);
    const result = include
      ? read?.(include.path) ?? { output: '', status: 1, error: '`include=` is not supported here' }
      : run(command);
    if (result.status !== 0 || result.error) {
      results.push({ directive, kind: 'failed', result });
      return undefined;
    }
    try {
      const text = include ? includeLines(result.output, include) : result.output;
      const formatted = options.format && !lint ? formatOutput(text, options.format) : text;
      // in lint mode, transform still runs, so it can report a formatter that didn't load
      const transformed = isCustom ? custom!.transform(directive, formatted, command) : formatted;
      return lint ? '' : transformed;
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
    /** Start and end comments accounted for (a pair per inline region) */
    let accounted = 0;
    for (const { match, command, options } of lineDirectives(text, line, syntax)) {
      // a start comment inside the previous inline region is old content, not a directive
      if (match.index < consumed) continue;
      const directive: Directive = { line, command, options: typeof options === 'string' ? {} : options };
      const afterStart = match.index + match[0].length - consumed;
      const mode = directive.options.mode;
      const close = mode && NO_END.includes(mode) ? null : end.exec(rest.slice(afterStart));
      if (!close) return { text: rewritten + rest, open: { directive, options }, accounted: accounted + 1 };
      const previous = rest.slice(afterStart, afterStart + close.index);
      const generated = generate(directive, options)?.trim();
      const next = lint ? undefined : generated;
      if (generated !== undefined) updated(directive, previous !== generated, 'inline', line);
      const length = afterStart + close.index + close[0].length;
      rewritten += rest.slice(0, afterStart) + (next ?? previous) + close[0];
      rest = rest.slice(length);
      consumed += length;
      accounted += 2 + markerMentions(previous, syntax);
    }
    return { text: rewritten + rest, open: undefined, accounted };
  };

  /** Index of the end marker closing a region whose body starts at `from`, or -1 when another directive (or the end of the file) comes first */
  const regionEnd = (from: number) => {
    for (let stop = from; stop < lines.length; stop++) {
      const nested = syntax.fences && openingFence(lines[stop]!);
      if (nested) {
        const close = closingFence(lines, stop, nested[2]!);
        if (close === -1) return -1;
        stop = close;
      } else if (lineDirectives(lines[stop]!, stop, syntax).length > 0) {
        return -1;
      } else if (end.test(lines[stop]!)) {
        return stop;
      }
    }
    return -1;
  };

  let i = 0;
  /** Keep a region that couldn't be regenerated as it is, through its end marker */
  const skipThrough = (stop: number) => {
    output.push(...lines.slice(i, stop + 1));
    i = stop + 1;
  };

  while (i < lines.length) {
    const fence = syntax.fences && openingFence(lines[i]!);
    if (fence) {
      const close = closingFence(lines, i, fence[2]!);
      const last = close === -1 ? lines.length - 1 : close;
      output.push(...lines.slice(i, last + 1));
      i = last + 1;
      continue;
    }

    // `MARKER ignore start` … `MARKER ignore end`: kept as is, directives and all
    const ignored = ignoredRange(lines, i, syntax);
    if (ignored !== undefined) {
      if (ignored === -1) {
        const expected = `${syntax.open} ${syntax.marker} ignore end${syntax.close ? ` ${syntax.close}` : ''}`;
        results.push({ directive: { line: i, command: '', options: {} }, kind: 'invalid', reason: `no \`${expected}\` follows this ignore start` });
        output.push(...lines.slice(i));
        break;
      }
      output.push(...lines.slice(i, ignored + 1));
      i = ignored + 1;
      continue;
    }

    const { text, open, accounted } = inline(lines[i]!, i);
    if (markerMentions(lines[i]!, syntax) > accounted) stray.push(i);
    output.push(text);
    i++;
    if (!open) continue;
    const { directive, options } = open;
    const { mode } = directive.options;
    const invalid = (reason: string) => results.push({ directive, kind: 'invalid', reason });
    // a bad mode or option is the real problem, not whatever the fallback mode would complain about
    if (typeof options === 'string') {
      invalid(options);
      // an end marker that follows still belongs to this directive, so it isn't stray
      const stop = regionEnd(i);
      if (stop !== -1) skipThrough(stop);
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
      updated(directive, target !== replacement, 'line', i);
      i++;
      continue;
    }

    if (mode && FENCED.includes(mode) && !syntax.fences) {
      invalid(`\`${mode}\` mode only works in markdown files (or a \`syntax\` rule with \`"fences": true\`)`);
      continue;
    }

    // console, console-pretty: the command and its output, in the fenced block(s) after the directive
    if (isConsole(mode)) {
      const stdout = generate(directive, options)?.replace(/\s+$/, '');
      if (stdout === undefined) continue;
      const { lang } = directive.options;
      const blocks = mode === 'console'
        ? [{ lang: lang ?? 'console', body: [`$ ${directive.command}`, ...stdout ? [stdout] : []].join('\n') }]
        : [{ lang: lang ?? 'sh', body: directive.command }, { lang: 'txt', body: stdout }];
      // the blocks already there: up to as many as this directive writes, with only blank lines before each
      const found: [number, number][] = [];
      let next = i;
      let unclosed = false;
      while (found.length < blocks.length) {
        let at = next;
        while (at < lines.length && lines[at]!.trim() === '') at++;
        const fence = at < lines.length && openingFence(lines[at]!);
        if (!fence) break;
        const closeAt = closingFence(lines, at, fence[2]!);
        if (closeAt === -1) {
          unclosed = true;
          break;
        }
        found.push([at, closeAt]);
        next = closeAt + 1;
      }
      if (unclosed) {
        invalid('the fenced code block after the directive is never closed');
        continue;
      }
      const prefix = lines[directive.line]!.match(/^\s*/)![0];
      const rendered = blocks.flatMap(({ lang: info, body }, n) => {
        const fence = fenceFor(body);
        return [...n > 0 ? [''] : [], `${prefix}${fence}${info}`, ...body ? [indent(body, prefix)] : [], `${prefix}${fence}`];
      });
      // blank lines between the directive and the first block stay as they are
      const keep = found.length > 0 ? lines.slice(i, found[0]![0]) : [];
      const last = found.length > 0 ? found.at(-1)![1] : i - 1;
      const previous = lines.slice(i + keep.length, last + 1).join('\n');
      output.push(...keep, ...rendered.join('\n').split('\n'));
      updated(directive, previous !== rendered.join('\n'), mode!, Math.max(last, directive.line));
      i = last + 1;
      continue;
    }

    // codeblock: only blank lines between the directive and an opening fence
    let next = i;
    while (syntax.fences && mode !== 'region' && next < lines.length && lines[next]!.trim() === '') next++;
    const codeFence = syntax.fences && mode !== 'region' && next < lines.length && openingFence(lines[next]!);
    if (mode === 'codeblock' && !codeFence && directive.options.lang) {
      // no block yet: create one right after the directive
      const body = generate(directive, options)?.replace(/\s+$/, '');
      if (body === undefined) continue;
      const indentation = lines[directive.line]!.match(/^\s*/)![0];
      const fence = fenceFor(body);
      output.push(`${indentation}${fence}${directive.options.lang}`);
      if (body !== '') output.push(indent(body, indentation));
      output.push(`${indentation}${fence}`);
      updated(directive, true, 'codeblock', directive.line);
      continue;
    }
    if (mode === 'codeblock' && !codeFence) {
      invalid('expected a fenced code block after the directive (only blank lines may come between; or set `lang=` to create one)');
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
      // `lang=` replaces the info string's first word, keeping any attributes after it
      const { lang } = directive.options;
      const opening = lang === undefined
        ? lines[next]!
        : `${codeFence[1]}${codeFence[2]}${codeFence[3]!.replace(/^\s*\S*/, lang)}`;
      output.push(...lines.slice(i, next), opening);
      if (replacement !== '') output.push(replacement);
      output.push(lines[close]!);
      updated(directive, previous !== replacement || opening !== lines[next], 'codeblock', close);
      i = close + 1;
      continue;
    }

    // region: everything up to the end marker, which must come before any other directive
    const stop = regionEnd(i);
    if (stop === -1) {
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
    if (body === undefined) {
      skipThrough(stop);
      continue;
    }
    const previous = lines.slice(i, stop).join('\n');
    const replacement = indent(body, lines[directive.line]!.match(/^\s*/)![0]);
    if (replacement !== '') output.push(replacement);
    output.push(lines[stop]!);
    updated(directive, previous !== replacement, 'region', stop);
    i = stop + 1;
  }

  return { content: output.join('\n'), results, stray };
}
