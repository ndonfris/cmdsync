/**
 * Custom directives from the config: templates and formatter modules.
 *
 *   "directives": {
 *     "quote":  { "template": "{output|quote}" },
 *     "help":   { "mode": "codeblock", "lang": "text", "command": "{cmd} --help" },
 *     "pretty": { "formatter": "./scripts/pretty.ts" }
 *   }
 */
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CustomDirective, ResolvedConfig } from './config.ts';
import type { Directive, Mode, UpdateOptions } from './regions.ts';

/** What a formatter gets for one directive */
export interface FormatterContext {
  /** The command's output (after `format=`, when the directive has one), trailing whitespace included */
  output: string;
  /** The command as written in the directive: `my-cli env` in `<!-- CMDSYNC name start: my-cli env -->` */
  input: string;
  /** The custom directive's name */
  name: string;
  /** The built-in mode that writes what the formatter returns */
  mode: Mode;
  /** `lang=` from the directive, or the custom directive's default */
  lang: string | undefined;
  /** The directive's other `key=value` words: `<!-- CMDSYNC quote start prefix=>>: cmd -->` → `{ prefix: '>>' }` */
  params: Record<string, string>;
  /** Absolute path of the file with the directive */
  file: string;
  /** 1-based line of the directive */
  line: number;
  config: ResolvedConfig;
}

/**
 * Turns a command's output into the text written for a directive. In `region`
 * mode, what it returns is the whole region, so it can add code blocks, quotes, ...
 */
export type Formatter = (context: FormatterContext) => string;

/** Identity helper, for typing a formatter module: `export default defineFormatter(ctx => ...)` */
export const defineFormatter = (formatter: Formatter): Formatter => formatter;

const fenceFor = (text: string) =>
  '`'.repeat(Math.max(3, ...[...text.matchAll(/^\s*(`{3,})/gm)].map(m => m[1]!.length + 1)));

/** Helpers for formatters (also behind the template filters of the same names) */

/** Wrap text in a fenced code block, with a fence longer than any inside it */
export const fence = (text: string, lang = '') => {
  const f = fenceFor(text);
  return `${f}${lang}\n${text.replace(/\n+$/, '')}\n${f}`;
};
/** Prefix every line (`> ` by default) */
export const quote = (text: string, prefix = '> ') => text.replace(/\n+$/, '').replace(/^/gm, prefix);
/** Indent every non-empty line by `by` spaces (2 by default), or by the text `by` */
export const indent = (text: string, by: number | string = 2) => {
  const prefix = typeof by === 'number' ? ' '.repeat(by) : by;
  return text.replace(/^(?=.)/gm, prefix);
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** `{name|filter|filter:arg}` filters */
const FILTERS: Record<string, (value: string, arg: string | undefined, vars: Record<string, string>) => string> = {
  trim: v => v.trim(),
  quote: (v, arg) => quote(v, arg ?? '> '),
  indent: (v, arg) => indent(v, arg === undefined ? 2 : /^\d+$/.test(arg) ? Number(arg) : arg),
  code: (v, arg, vars) => fence(v, arg ?? vars.lang ?? ''),
  json: v => JSON.stringify(v),
  html: v => escapeHtml(v),
  upper: v => v.toUpperCase(),
  lower: v => v.toLowerCase(),
  first: v => v.split('\n')[0] ?? '',
  last: v => v.replace(/\n+$/, '').split('\n').at(-1) ?? '',
  lines: v => String(v.replace(/\n+$/, '').split('\n').length),
  default: (v, arg) => v === '' ? arg ?? '' : v,
};

export const TEMPLATE_FILTERS = Object.keys(FILTERS);

/**
 * Fill `{name}` placeholders (`{env.HOME}`, `{params.key}`, ...), each optionally
 * piped through filters: `{output|trim|quote}`, `{output|code:txt}`, `{params.x|default:y}`.
 * `{{` and `}}` are literal braces. Unknown placeholders and filters throw.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{([\w.-]+)((?:\|[\w-]+(?::[^|}]*)?)*)\}/g, (all, name: string | undefined, pipes: string) => {
    if (all === '{{') return '{';
    if (all === '}}') return '}';
    if (!(name! in vars)) {
      if (name!.startsWith('params.') || name!.startsWith('env.')) {
        if (!pipes.includes('|default')) throw new Error(`template: {${name}} is not set (add |default:value to make it optional)`);
      } else {
        throw new Error(`template: unknown placeholder {${name}} (known: ${Object.keys(vars).filter(k => !k.includes('.')).join(', ')}, env.NAME, params.NAME)`);
      }
    }
    let value = vars[name!] ?? '';
    for (const pipe of pipes.split('|').slice(1)) {
      const [filter, ...rest] = pipe.split(':');
      const apply = FILTERS[filter!];
      if (!apply) throw new Error(`template: unknown filter |${filter} (known: ${TEMPLATE_FILTERS.join(', ')})`);
      value = apply(value, rest.length ? rest.join(':') : undefined, vars);
    }
    return value;
  });
}

const today = () => new Date().toISOString();

/** Placeholders for one directive; `command` is what ran (the custom directive's `command`, filled in) */
export function templateVars(context: FormatterContext, command = context.input): Record<string, string> {
  const now = today();
  const file = relative(context.config.root, context.file) || context.file;
  return {
    output: context.output,
    input: context.input,
    cmd: context.input,
    command,
    name: context.name,
    mode: context.mode,
    lang: context.lang ?? '',
    file,
    dir: dirname(file),
    line: String(context.line),
    marker: context.config.marker,
    date: now.slice(0, 10),
    datetime: now,
    year: now.slice(0, 4),
    fence: fenceFor(context.output),
    ...Object.fromEntries(Object.entries({ ...process.env, ...context.config.env }).map(([k, v]) => [`env.${k}`, v ?? ''])),
    ...Object.fromEntries(Object.entries(context.params).map(([k, v]) => [`params.${k}`, v])),
  };
}

/** A formatter module, loaded; or why it couldn't be */
export type LoadedFormatter = Formatter | Error;

/**
 * Import every custom directive's `formatter` module (relative to the config root).
 * `.ts` modules work on Node >= 22.18, which strips types natively. A module's default
 * export (or its `format` export) must be a function. Errors are kept, not thrown,
 * so only the directives that use a broken formatter fail.
 */
export async function loadFormatters(config: ResolvedConfig): Promise<Map<string, LoadedFormatter>> {
  const loaded = new Map<string, LoadedFormatter>();
  for (const path of new Set(Object.values(config.directives).flatMap(d => d.formatter ? [d.formatter] : []))) {
    const file = resolve(config.root, path);
    try {
      if (!existsSync(file)) throw new Error(`no such file: ${file}`);
      const module = await import(pathToFileURL(file).href) as { default?: unknown; format?: unknown; };
      const formatter = typeof module.default === 'function' ? module.default : module.format;
      if (typeof formatter !== 'function') throw new Error('its default export (or `format` export) is not a function');
      loaded.set(path, formatter as Formatter);
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code === 'ERR_UNKNOWN_FILE_EXTENSION'
        ? 'this Node version can\'t import TypeScript; use Node >= 22.18, or a .js/.mjs formatter'
        : (err as Error).message;
      loaded.set(path, new Error(`formatter ${path}: ${reason}`));
    }
  }
  return loaded;
}

/** The `custom` hooks of `updateRegions` for one file */
export function customHooks(
  config: ResolvedConfig,
  file: string,
  formatters: Map<string, LoadedFormatter> | undefined,
  lint = false,
): NonNullable<UpdateOptions['custom']> {
  const definition = (directive: Directive): CustomDirective => config.directives[directive.options.custom!]!;
  const contextFor = (directive: Directive, output: string): FormatterContext => ({
    output,
    input: directive.command,
    name: directive.options.custom!,
    mode: directive.options.mode ?? 'region',
    lang: directive.options.lang,
    params: directive.options.params ?? {},
    file,
    line: directive.line + 1,
    config,
  });

  return {
    command: directive => {
      const { command } = definition(directive);
      return command ? renderTemplate(command, templateVars(contextFor(directive, ''))) : directive.command;
    },
    transform: (directive, output, command) => {
      const { formatter: path, template } = definition(directive);
      let formatter: Formatter | undefined;
      if (path) {
        const loaded = formatters?.get(path);
        if (!loaded) throw new Error(`formatter ${path} was not loaded (call loadFormatters first)`);
        if (loaded instanceof Error) throw loaded;
        formatter = loaded;
      }
      if (lint) return '';
      const context = contextFor(directive, output);
      let text = output;
      if (formatter) {
        const result = formatter(context);
        if (typeof result !== 'string') throw new Error(`formatter ${path} returned ${typeof result}, not a string`);
        text = result;
      }
      return template === undefined ? text : renderTemplate(template, { ...templateVars(context, command), output: text, fence: fenceFor(text) });
    },
  };
}
