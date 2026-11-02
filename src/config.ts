import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

/** Config as written by the user (every field is optional) */
export interface UserConfig {
  /** Start of a region: `<!-- MARKER: command -->` */
  marker?: string;
  /** End of a region: `<!-- END_MARKER -->` (default: `/` + marker) */
  endMarker?: string;
  /** Shell binary used to run each command (`sh`, `bash`, `fish`, `/usr/bin/fish`, ...) */
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
}

export interface ResolvedConfig extends Required<Omit<UserConfig, 'comment'>> {
  comment: string[] | null;
  /** Directory the config was loaded from; relative paths resolve against it */
  root: string;
  /** Where the config came from, or `null` when only defaults are used */
  source: string | null;
}

export const DEFAULT_CONFIG = {
  marker: 'CMDSYNC',
  shell: 'sh',
  commands: [],
  install: {},
  include: ['**/*.md', '**/*.mdx'],
  exclude: ['**/node_modules/**', '**/.git/**'],
  syntax: [],
  cwd: '.',
  timeout: 60_000,
  env: {},
} satisfies UserConfig;

/** `CMDSYNC` → `/CMDSYNC` */
export const defaultEndMarker = (marker: string) => `/${marker}`;

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
const isEndMarker = (v: unknown) => typeof v === 'string' && /^[\w./-]+$/.test(v);
const isComment = (v: unknown) => isStringArray(v) && v.length >= 1 && v.length <= 2 && v[0] !== '';

const isSyntaxRule = (v: unknown) =>
  isObject(v) &&
  Object.keys(v).every(k => ['include', 'comment', 'marker', 'endMarker', 'fences'].includes(k)) &&
  isStringArray(v.include) && v.include.length > 0 &&
  isComment(v.comment) &&
  (v.marker === undefined || isMarker(v.marker)) &&
  (v.endMarker === undefined || isEndMarker(v.endMarker)) &&
  (v.fences === undefined || typeof v.fences === 'boolean');

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

export function resolveConfig(
  options: { cwd?: string; configPath?: string; overrides?: UserConfig; } = {},
): ResolvedConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const found = options.configPath ? loadConfigFile(options.configPath) : findConfig(cwd);
  const root = found?.root ?? cwd;
  const merged: UserConfig = { ...DEFAULT_CONFIG, ...found?.config, ...options.overrides };
  return {
    ...DEFAULT_CONFIG,
    ...merged,
    endMarker: merged.endMarker ?? defaultEndMarker(merged.marker ?? DEFAULT_CONFIG.marker),
    comment: merged.comment ?? null,
    cwd: resolve(root, merged.cwd ?? DEFAULT_CONFIG.cwd),
    root,
    source: found?.source ?? null,
  };
}
