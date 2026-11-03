/**
 * The global config: defaults merged under every repository's own config, and
 * the repositories `cmdsync --all` / `--group` / `--repo` run in.
 *
 *   $CMDSYNC_GLOBAL_CONFIG, or $XDG_CONFIG_HOME/cmdsync/config.json, or ~/.config/cmdsync/config.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type UserConfig, validateConfig } from './config.ts';

export const GLOBAL_SCHEMA_URL = 'https://unpkg.com/cmdsync/cmdsync.global.schema.json';

export interface Repo {
  /** Absolute, or starting with `~/` */
  path: string;
  /** Used by `--repo` (default: the directory's name) */
  name?: string;
  /** Used by `--group` */
  groups?: string[];
}

export interface GlobalConfig {
  /** Config merged under every repository's own config (which wins) */
  defaults?: UserConfig;
  repos?: Repo[];
}

export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CMDSYNC_GLOBAL_CONFIG) return resolve(env.CMDSYNC_GLOBAL_CONFIG);
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'cmdsync', 'config.json');
}

export const expandHome = (path: string) => path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;

/** `/home/me/repos/a` → `~/repos/a`, so the global config can be shared between machines */
export const contractHome = (path: string) => {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

export const repoName = (repo: Repo) => repo.name ?? basename(expandHome(repo.path));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRepo = (v: unknown): v is Repo =>
  isObject(v) &&
  Object.keys(v).every(k => ['path', 'name', 'groups'].includes(k)) &&
  typeof v.path === 'string' && v.path.length > 0 &&
  (v.name === undefined || (typeof v.name === 'string' && v.name.length > 0)) &&
  (v.groups === undefined || (Array.isArray(v.groups) && v.groups.every(g => typeof g === 'string' && g.length > 0)));

export function validateGlobalConfig(value: unknown, source: string): GlobalConfig {
  if (!isObject(value)) throw new Error(`${source}: global config must be an object`);
  for (const key of Object.keys(value)) {
    if (!['$schema', 'defaults', 'repos'].includes(key)) throw new Error(`${source}: unknown global config key "${key}"`);
  }
  const config: GlobalConfig = {};
  if (value.defaults !== undefined) config.defaults = validateConfig(value.defaults, `${source}#defaults`);
  if (value.repos !== undefined) {
    if (!Array.isArray(value.repos)) throw new Error(`${source}: "repos" must be an array`);
    value.repos.forEach((repo, i) => {
      if (!isRepo(repo)) throw new Error(`${source}: invalid repos[${i}]: ${JSON.stringify(repo)} (expected { "path": string, "name"?: string, "groups"?: string[] })`);
    });
    config.repos = value.repos as Repo[];
    const names = config.repos.map(repoName);
    const duplicate = names.find((n, i) => names.indexOf(n) !== i);
    if (duplicate) throw new Error(`${source}: two repos are named "${duplicate}", give one a "name"`);
  }
  return config;
}

/** The global config, or `null` when the file doesn't exist */
export function loadGlobalConfig(path = globalConfigPath()): GlobalConfig | null {
  if (!existsSync(path)) return null;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
  return validateGlobalConfig(json, path);
}

export function saveGlobalConfig(config: GlobalConfig, path = globalConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ $schema: GLOBAL_SCHEMA_URL, ...config }, null, 2)}\n`);
}

/**
 * Repositories picked by `--all`, `--group` and `--repo` (by name or path).
 * Throws for a group or repo that matches nothing, so typos don't silently do nothing.
 */
export function selectRepos(config: GlobalConfig, by: { all?: boolean; groups?: string[]; repos?: string[]; }): Repo[] {
  const repos = config.repos ?? [];
  if (by.all) return repos;
  const picked = new Set<Repo>();
  for (const group of by.groups ?? []) {
    const matches = repos.filter(r => r.groups?.includes(group));
    if (matches.length === 0) throw new Error(`no repos in group "${group}"`);
    matches.forEach(r => picked.add(r));
  }
  for (const wanted of by.repos ?? []) {
    const path = resolve(expandHome(wanted));
    const match = repos.find(r => repoName(r) === wanted || resolve(expandHome(r.path)) === path);
    if (!match) throw new Error(`no repo named "${wanted}" in the global config`);
    picked.add(match);
  }
  return repos.filter(r => picked.has(r));
}
