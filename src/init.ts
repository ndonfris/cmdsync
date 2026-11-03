/** `cmdsync init` (a repository's config) and `cmdsync init global` */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_FILE, DEFAULT_CONFIG, PACKAGE_JSON_KEY, findConfig } from './config.ts';
import { type GlobalConfig, type Repo, expandHome, globalConfigPath, loadGlobalConfig, repoName, saveGlobalConfig } from './global.ts';

export const SCHEMA_URL = 'https://unpkg.com/cmdsync/cmdsync.schema.json';

/** Config keys of the old `update-codeblocks` package, which `cmdsync migrate` converts */
export const LEGACY_FILES = ['update-codeblocks.json', '.update-codeblocks.json'];
export const LEGACY_PACKAGE_JSON_KEY = 'update-codeblocks';

export type InitResult =
  | { kind: 'created'; file: string; }
  | { kind: 'exists'; file: string; }
  /** An `update-codeblocks` config is there: `cmdsync migrate` converts it instead */
  | { kind: 'legacy'; file: string; };

const starter = () => ({
  include: DEFAULT_CONFIG.include,
  exclude: DEFAULT_CONFIG.exclude,
  commands: [] as string[],
});

/** Write a starter config to `cmdsync.json` in `dir`, or (with `packageJson`) to the `"cmdsync"` key of its `package.json` */
export function initConfig(dir: string, options: { packageJson?: boolean; } = {}): InitResult {
  const root = resolve(dir);
  const existing = findConfig(root);
  if (existing && existing.root === root) return { kind: 'exists', file: existing.source };
  const legacy = legacyConfig(root);
  if (legacy) return { kind: 'legacy', file: legacy };

  if (options.packageJson) {
    const pkg = join(root, 'package.json');
    if (!existsSync(pkg)) throw new Error(`${pkg} does not exist`);
    const text = readFileSync(pkg, 'utf-8');
    const json = JSON.parse(text) as Record<string, unknown>;
    json[PACKAGE_JSON_KEY] = starter();
    const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
    writeFileSync(pkg, `${JSON.stringify(json, null, indent)}\n`);
    return { kind: 'created', file: `${pkg}#${PACKAGE_JSON_KEY}` };
  }
  const file = join(root, CONFIG_FILE);
  writeFileSync(file, `${JSON.stringify({ $schema: SCHEMA_URL, ...starter() }, null, 2)}\n`);
  return { kind: 'created', file };
}

/** An `update-codeblocks` config file, or package.json key, in `dir` */
export function legacyConfig(dir: string): string | undefined {
  const file = LEGACY_FILES.map(f => join(dir, f)).find(f => existsSync(f));
  if (file) return file;
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg)) return undefined;
  try {
    const json = JSON.parse(readFileSync(pkg, 'utf-8'));
    return json && typeof json === 'object' && LEGACY_PACKAGE_JSON_KEY in json ? `${pkg}#${LEGACY_PACKAGE_JSON_KEY}` : undefined;
  } catch {
    return undefined;
  }
}

/** Create the global config if it doesn't exist, and optionally add a repository to it */
export function initGlobal(options: { path?: string; add?: Repo; } = {}): { file: string; created: boolean; added: boolean; } {
  const file = options.path ?? globalConfigPath();
  const current = loadGlobalConfig(file);
  const config: GlobalConfig = current ?? { defaults: {}, repos: [] };
  const added = options.add ? addRepo(config, options.add) : false;
  if (!current || added) saveGlobalConfig(config, file);
  return { file, created: !current, added };
}

/** Add `repo` unless a repo with the same path is there; throws when the name is taken by another path */
export function addRepo(config: GlobalConfig, repo: Repo): boolean {
  const repos = config.repos ??= [];
  const path = resolve(expandHome(repo.path));
  if (repos.some(r => resolve(expandHome(r.path)) === path)) return false;
  const name = repoName(repo);
  if (repos.some(r => repoName(r) === name)) throw new Error(`a repo named "${name}" is already in the global config, pass --name`);
  repos.push(repo);
  return true;
}

export function removeRepo(config: GlobalConfig, nameOrPath: string): Repo | undefined {
  const repos = config.repos ?? [];
  const path = resolve(expandHome(nameOrPath));
  const index = repos.findIndex(r => repoName(r) === nameOrPath || resolve(expandHome(r.path)) === path);
  return index === -1 ? undefined : repos.splice(index, 1)[0];
}
