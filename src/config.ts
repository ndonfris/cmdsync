import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ShellSource, currentShell } from './shell.ts';

/** Name of the standalone config file, and of the key used inside `package.json` */
export const CONFIG_FILE = 'cmdsync.json';
export const PACKAGE_JSON_KEY = 'cmdsync';

/** Comment syntax (and optionally markers) for files the built-in table doesn't cover, or should be overridden */
export interface SyntaxRule {
  /** Globs (relative to the config root) this rule applies to; the first matching rule wins */
  include: string[];
  /** Comment delimiters: `["#"]` for line comments, `["<!--", "-->"]` for block comments */
  comment: string[];
  /** Start marker for these files (default: the top-level `marker`) */
  marker?: string;
  /** End marker for these files (default: the top-level `endMarker`) */
  endMarker?: string;
  /** Treat as markdown: skip fenced/inline code, allow the fenced code block form */
  fences?: boolean;
}

/** Built-in modes a custom directive can build on (kept here so config.ts doesn't depend on the scanner) */
export const BASE_MODES = ['region', 'line', 'codeblock', 'console', 'console-pretty'] as const;

/**
 * A directive defined in the config, used like a mode: `<!-- CMDSYNC name start: args -->`.
 * The command runs, then `formatter` and/or `template` turn its output into what's written.
 */
export interface CustomDirective {
  /** The built-in mode that writes the result (default: `region`) */
  mode?: typeof BASE_MODES[number];
  /** The command to run, with `{cmd}` for what the directive says (default: `{cmd}`) */
  command?: string;
  /** Default `lang=` (codeblock and console modes) */
  lang?: string;
  /** Default `format=`, applied to the output before `formatter` and `template` */
  format?: 'md-table' | 'html-table';
  /** Text written, with `{output}`, `{cmd}`, `{file}`, ... placeholders and `|filters` (see docs/custom-directives.md) */
  template?: string;
  /** JS/TS module (relative to the config root) whose default export turns the output into what's written */
  formatter?: string;
  /** Shown by `cmdsync lint` and in docs */
  description?: string;
}

/** Config as written by the user (every field is optional) */
export interface UserConfig {
  /** Starts a directive: `<!-- MARKER start: command -->` */
  marker?: string;
  /** End of a region: `<!-- END_MARKER -->` (default: marker + ` end`) */
  endMarker?: string;
  /**
   * Shell binary used to run each command (`sh`, `bash`, `fish`, `/usr/bin/fish`, ...), or `auto`
   * (the default): the shell cmdsync was started from (see `detectShell`)
   */
  shell?: string;
  /**
   * Command binaries that directives are allowed to run. Every command in a
   * pipeline/list (`a | b`, `a && b`, `a; b`) must be recognized.
   * Omit (or leave empty) to allow any command.
   */
  commands?: string[];
  /**
   * How to install a binary that directives run, keyed by binary name:
   * `{ "my-cli": "npm install -g my-cli" }`. Runs with the same shell, cwd and
   * env as directives, when a directive needs the binary and it isn't on `PATH`.
   */
  install?: Record<string, string>;
  /** Globs (relative to the config root) of files to scan */
  include?: string[];
  /** Globs (relative to the config root) to skip */
  exclude?: string[];
  /** Comment syntax per glob, checked before the built-in table */
  syntax?: SyntaxRule[];
  /** Comment delimiters for every file, overriding `syntax` and the built-in table (mainly for `--comment`) */
  comment?: string[];
  /** Working directory for commands, relative to the config root */
  cwd?: string;
  /** Per-command timeout in milliseconds */
  timeout?: number;
  /** Extra environment variables passed to every command */
  env?: Record<string, string>;
  /**
   * Commands run, in order, after an update wrote at least one file (`prettier --write .`,
   * `git add -A docs`, ...). Same shell, cwd and env as directives, plus
   * `CMDSYNC_CHANGED_FILES`: the written files, one per line, relative to the config root.
   */
  postUpdate?: string[];
  /** Custom directives by name, used like a mode: `<!-- CMDSYNC name: command -->` */
  directives?: Record<string, CustomDirective>;
}

export interface ResolvedConfig extends Required<Omit<UserConfig, 'comment'>> {
  comment: string[] | null;
  /** Directory the config was loaded from; relative paths resolve against it */
  root: string;
  /** Where the config came from, or `null` when only defaults are used */
  source: string | null;
  /** How `shell` was found, when it was `auto` */
  shellFrom?: ShellSource;
}

export const DEFAULT_CONFIG = {
  marker: 'CMDSYNC',
  shell: 'auto',
  commands: [],
  install: {},
  include: ['**/*.md', '**/*.mdx'],
  exclude: ['**/node_modules/**', '**/.git/**'],
  syntax: [],
  cwd: '.',
  timeout: 60_000,
  env: {},
  postUpdate: [],
  directives: {},
} satisfies UserConfig;

/** `CMDSYNC` → `CMDSYNC end` */
export const defaultEndMarker = (marker: string) => `${marker} end`;

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string');

const isMarker = (v: unknown) => typeof v === 'string' && /^[\w.-]+$/.test(v);
const isEndMarker = (v: unknown) => typeof v === 'string' && /^[\w./-]+( [\w./-]+)*$/.test(v);
const isComment = (v: unknown) => isStringArray(v) && v.length >= 1 && v.length <= 2 && v[0] !== '';

const isSyntaxRule = (v: unknown) =>
  isObject(v) &&
  Object.keys(v).every(k => ['include', 'comment', 'marker', 'endMarker', 'fences'].includes(k)) &&
  isStringArray(v.include) && v.include.length > 0 &&
  isComment(v.comment) &&
  (v.marker === undefined || isMarker(v.marker)) &&
  (v.endMarker === undefined || isEndMarker(v.endMarker)) &&
  (v.fences === undefined || typeof v.fences === 'boolean');

/** Names that can't be custom directives, since the directive grammar already uses them */
const RESERVED = new Set<string>([...BASE_MODES, 'start', 'end']);

const isCustomDirective = (v: unknown) =>
  isObject(v) &&
  Object.keys(v).every(k => ['mode', 'command', 'lang', 'format', 'template', 'formatter', 'description'].includes(k)) &&
  (v.mode === undefined || (BASE_MODES as readonly unknown[]).includes(v.mode)) &&
  (v.command === undefined || (typeof v.command === 'string' && v.command.trim().length > 0)) &&
  (v.lang === undefined || (typeof v.lang === 'string' && /^[\w.+#-]+$/.test(v.lang))) &&
  (v.format === undefined || v.format === 'md-table' || v.format === 'html-table') &&
  (v.template === undefined || typeof v.template === 'string') &&
  (v.formatter === undefined || (typeof v.formatter === 'string' && v.formatter.length > 0)) &&
  (v.description === undefined || typeof v.description === 'string');

const isDirectives = (v: unknown) =>
  isObject(v) && Object.entries(v).every(([name, d]) => /^[a-z][\w-]*$/.test(name) && !RESERVED.has(name) && isCustomDirective(d));

/** Throws a readable error for any unknown key or wrongly typed value */
export function validateConfig(value: unknown, source: string): UserConfig {
  if (!isObject(value)) throw new Error(`${source}: config must be an object`);

  const checks: Record<keyof UserConfig | '$schema', (v: unknown) => boolean> = {
    $schema: v => typeof v === 'string',
    marker: isMarker,
    endMarker: isEndMarker,
    shell: v => typeof v === 'string' && v.length > 0,
    commands: isStringArray,
    install: v => isObject(v) && Object.values(v).every(e => typeof e === 'string' && e.length > 0),
    include: isStringArray,
    exclude: isStringArray,
    syntax: v => Array.isArray(v) && v.every(isSyntaxRule),
    comment: isComment,
    cwd: v => typeof v === 'string',
    timeout: v => typeof v === 'number' && v > 0,
    env: v => isObject(v) && Object.values(v).every(e => typeof e === 'string'),
    postUpdate: v => isStringArray(v) && v.every(c => c.trim().length > 0),
    directives: isDirectives,
  };

  Object.entries(value).forEach(([key, v]) => {
    const check = checks[key as keyof typeof checks];
    if (!check) throw new Error(`${source}: unknown config key "${key}"`);
    if (!check(v)) throw new Error(`${source}: invalid value for "${key}": ${JSON.stringify(v)}`);
  });

  const { $schema: _, ...config } = value as UserConfig & { $schema?: string; };
  return config;
}

/**
 * Find the user's config, walking up from `cwd`. In each directory
 * `cmdsync.json` wins over the `"cmdsync"` key in `package.json`.
 */
export function findConfig(cwd: string): { config: UserConfig; root: string; source: string; } | null {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) {
      return { config: validateConfig(readJson(file), file), root: dir, source: file };
    }
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      const json = readJson(pkg);
      if (isObject(json) && PACKAGE_JSON_KEY in json) {
        const source = `${pkg}#${PACKAGE_JSON_KEY}`;
        return { config: validateConfig(json[PACKAGE_JSON_KEY], source), root: dir, source };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The file `findConfig` would read (`cmdsync.json`, or a `package.json` with a `"cmdsync"` key),
 * without validating it, so a broken config can still be shown and edited. `null` when there's none.
 */
export function locateConfig(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) return file;
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf-8'));
        if (isObject(json) && PACKAGE_JSON_KEY in json) return pkg;
      } catch {
        // an unparsable package.json isn't a config
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load a config from an explicit path (`cmdsync.json` or `package.json`) */
export function loadConfigFile(path: string): { config: UserConfig; root: string; source: string; } {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`Config file does not exist: ${file}`);
  const json = readJson(file);
  if (file.endsWith('package.json')) {
    if (!isObject(json) || !(PACKAGE_JSON_KEY in json)) {
      throw new Error(`${file} has no "${PACKAGE_JSON_KEY}" key`);
    }
    const source = `${file}#${PACKAGE_JSON_KEY}`;
    return { config: validateConfig(json[PACKAGE_JSON_KEY], source), root: dirname(file), source };
  }
  return { config: validateConfig(json, file), root: dirname(file), source: file };
}

/** Where a resolved setting came from */
export type ConfigLayer = 'default' | 'global' | 'config' | 'flag';

/** Keys whose entries merge one by one across layers, instead of being replaced */
const MERGED_KEYS = ['install', 'env', 'directives'] as const;

type ResolveOptions = { cwd?: string; configPath?: string; overrides?: UserConfig; defaults?: UserConfig; };

/**
 * Built-in defaults < `defaults` (the global config's) < the config file < `overrides` (CLI flags).
 * `install`, `env` and `directives` merge key by key; every other key is replaced.
 */
export function resolveConfig(options: ResolveOptions = {}): ResolvedConfig {
  return resolveConfigSources(options).config;
}

/**
 * `resolveConfig`, plus which layer each setting came from: a layer per key, or per
 * entry for `install`, `env` and `directives` (`cmdsync --show --resolved`).
 */
export function resolveConfigSources(options: ResolveOptions = {}): {
  config: ResolvedConfig;
  sources: Record<string, ConfigLayer | Record<string, ConfigLayer>>;
} {
  const cwd = resolve(options.cwd ?? process.cwd());
  const found = options.configPath ? loadConfigFile(options.configPath) : findConfig(cwd);
  const root = found?.root ?? cwd;
  const layers: [ConfigLayer, UserConfig][] = [
    ['default', DEFAULT_CONFIG],
    ['global', options.defaults ?? {}],
    ['config', found?.config ?? {}],
    ['flag', options.overrides ?? {}],
  ];
  const values = layers.map(([, l]) => l);
  const merged: UserConfig = {
    ...Object.assign({}, ...values),
    install: Object.assign({}, ...values.map(l => l.install)),
    env: Object.assign({}, ...values.map(l => l.env)),
    directives: Object.assign({}, ...values.map(l => l.directives)),
  };

  const sources: Record<string, ConfigLayer | Record<string, ConfigLayer>> = {};
  for (const [layer, config] of layers) {
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      if ((MERGED_KEYS as readonly string[]).includes(key)) {
        const entries = (sources[key] ??= {}) as Record<string, ConfigLayer>;
        for (const name of Object.keys(value as object)) entries[name] = layer;
      } else {
        sources[key] = layer;
      }
    }
  }
  // derived from other settings when not set
  sources.endMarker ??= sources.marker as ConfigLayer;
  sources.comment ??= 'default';

  const auto = merged.shell === 'auto' ? currentShell() : undefined;
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...merged,
      ...auto && { shell: auto.shell, shellFrom: auto.from },
      endMarker: merged.endMarker ?? defaultEndMarker(merged.marker ?? DEFAULT_CONFIG.marker),
      comment: merged.comment ?? null,
      cwd: resolve(root, merged.cwd ?? DEFAULT_CONFIG.cwd),
      root,
      source: found?.source ?? null,
    },
    sources,
  };
}
