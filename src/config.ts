import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Name of the standalone config file, and of the key used inside `package.json` */
export const CONFIG_FILE = 'update-codeblocks.json';
export const PACKAGE_JSON_KEY = 'update-codeblocks';

/** Config as written by the user (every field is optional) */
export interface UserConfig {
  /** Directive name inside the html comment: `<!-- MARKER: command -->` */
  marker?: string;
  /** Shell binary used to run each command (`sh`, `bash`, `fish`, `/usr/bin/fish`, ...) */
  shell?: string;
  /**
   * Command binaries that directives are allowed to run. Every command in a
   * pipeline/list (`a | b`, `a && b`, `a; b`) must be recognized.
   * Omit (or leave empty) to allow any command.
   */
  commands?: string[];
  /** Globs (relative to the config root) of markdown files to scan */
  include?: string[];
  /** Globs (relative to the config root) to skip */
  exclude?: string[];
  /** Working directory for commands, relative to the config root */
  cwd?: string;
  /** Per-command timeout in milliseconds */
  timeout?: number;
  /** Extra environment variables passed to every command */
  env?: Record<string, string>;
}

export interface ResolvedConfig extends Required<UserConfig> {
  /** Directory the config was loaded from; relative paths resolve against it */
  root: string;
  /** Where the config came from, or `null` when only defaults are used */
  source: string | null;
}

export const DEFAULT_CONFIG: Required<UserConfig> = {
  marker: 'UPDATE_CODEBLOCK',
  shell: 'sh',
  commands: [],
  include: ['**/*.md'],
  exclude: ['**/node_modules/**', '**/.git/**'],
  cwd: '.',
  timeout: 60_000,
  env: {},
};

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

/** Throws a readable error for any unknown key or wrongly typed value */
export function validateConfig(value: unknown, source: string): UserConfig {
  if (!isObject(value)) throw new Error(`${source}: config must be an object`);

  const checks: Record<keyof UserConfig | '$schema', (v: unknown) => boolean> = {
    $schema: v => typeof v === 'string',
    marker: v => typeof v === 'string' && /^[\w.-]+$/.test(v),
    shell: v => typeof v === 'string' && v.length > 0,
    commands: isStringArray,
    include: isStringArray,
    exclude: isStringArray,
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
 * `update-codeblocks.json` wins over the `"update-codeblocks"` key in `package.json`.
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

/** Load a config from an explicit path (`update-codeblocks.json` or `package.json`) */
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
  const merged = { ...DEFAULT_CONFIG, ...found?.config, ...options.overrides };
  return {
    ...merged,
    cwd: resolve(root, merged.cwd),
    root,
    source: found?.source ?? null,
  };
}
