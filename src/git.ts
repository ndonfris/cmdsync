/** Git helpers for `--staged` and `cmdsync hook install` */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

function git(args: string[], cwd: string): string {
  const { stdout, stderr, status, error } = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (error) throw new Error(`git ${args.join(' ')}: ${error.message}`);
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${stderr.trim() || `exited with status ${status}`}`);
  return stdout;
}

const nulSeparated = (output: string) => output.split('\0').filter(Boolean);

export function gitRoot(cwd: string): string {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch {
    throw new Error(`${cwd} is not inside a git repository`);
  }
}

/** Absolute paths of tracked files, and of tracked files with unstaged changes */
export function gitStatus(root: string): { tracked: Set<string>; unstaged: Set<string>; } {
  const absolute = (files: string[]) => new Set(files.map(f => join(root, f)));
  return {
    tracked: absolute(nulSeparated(git(['ls-files', '-z'], root))),
    unstaged: absolute(nulSeparated(git(['diff', '--name-only', '-z'], root))),
  };
}

export function stage(root: string, files: string[]): void {
  if (files.length > 0) git(['add', '--', ...files.map(f => relative(root, f))], root);
}

/** How to run the locally installed cmdsync, by the lockfile next to `package.json` */
export function hookCommand(root: string): string {
  const has = (file: string) => existsSync(join(root, file));
  if (!has('package.json')) return 'cmdsync --staged';
  if (has('yarn.lock')) return 'yarn cmdsync --staged';
  if (has('pnpm-lock.yaml')) return 'pnpm exec cmdsync --staged';
  if (has('bun.lock') || has('bun.lockb')) return 'bunx cmdsync --staged';
  // without `--`, npm parses `--staged` as one of its own options
  return 'npm exec -- cmdsync --staged';
}

export type HookInstall =
  | { kind: 'created'; file: string; command: string; }
  | { kind: 'already-installed'; file: string; }
  /** A hook (or hook manager) already exists: the user adds `snippet` themselves */
  | { kind: 'manual'; file: string; snippet: string; };

/**
 * Add `cmdsync --staged` to the pre-commit hook. Like lint-staged, an existing
 * hook or hook manager config is never edited: the line to add is returned instead.
 */
export function installHook(cwd: string): HookInstall {
  const root = gitRoot(cwd);
  const command = hookCommand(root);
  const read = (file: string) => existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
  const mentions = (file: string) => read(file)?.includes('cmdsync') ?? false;

  // hook managers own .git/hooks, so a file written there would be overwritten
  for (const file of ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'].map(f => join(root, f))) {
    if (!existsSync(file)) continue;
    if (mentions(file)) return { kind: 'already-installed', file };
    return { kind: 'manual', file, snippet: `pre-commit:\n  commands:\n    cmdsync:\n      run: ${command}` };
  }
  const preCommitConfig = join(root, '.pre-commit-config.yaml');
  if (existsSync(preCommitConfig)) {
    if (mentions(preCommitConfig)) return { kind: 'already-installed', file: preCommitConfig };
    return {
      kind: 'manual',
      file: preCommitConfig,
      snippet: 'repos:\n  - repo: https://github.com/ndonfris/cmdsync\n    rev: master\n    hooks:\n      - id: cmdsync',
    };
  }
  const pkg = join(root, 'package.json');
  if (existsSync(pkg) && JSON.parse(read(pkg)!)['simple-git-hooks']) {
    if (mentions(pkg)) return { kind: 'already-installed', file: pkg };
    return { kind: 'manual', file: pkg, snippet: `"simple-git-hooks": {\n  "pre-commit": "${command}"\n}` };
  }

  // husky (v9 sets core.hooksPath to .husky/_ and runs .husky/<hook>), else the hooks dir git uses
  const hooksDir = resolve(cwd, git(['rev-parse', '--git-path', 'hooks'], cwd).trim());
  const husky = /[\\/]\.husky([\\/]_)?$/.test(hooksDir) ? join(root, '.husky') : undefined;
  const file = join(husky ?? hooksDir, 'pre-commit');

  const existing = read(file);
  if (existing?.includes('cmdsync')) return { kind: 'already-installed', file };
  // a global core.hooksPath runs for every repo, so never write outside this one
  const outside = relative(root, file).startsWith('..') && relative(resolve(root, '.git'), file).startsWith('..');
  if (existing !== undefined || outside) return { kind: 'manual', file, snippet: command };

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${command}\n`);
  chmodSync(file, 0o755);
  return { kind: 'created', file, command };
}
