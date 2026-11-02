import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { hookCommand, installHook } from '../src/git.js';

// keep the user's global/system git config (hooksPath, commit hooks, signing) out of these repos
const gitConfig = join(mkdtempSync(join(tmpdir(), 'cmdsync-gitconfig-')), 'config');
writeFileSync(gitConfig, '');
process.env.GIT_CONFIG_GLOBAL = gitConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');
const tsx = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');

const sh = (cwd: string, ...args: string[]) => {
  const { stdout, stderr, status } = spawnSync(args[0]!, args.slice(1), { cwd, encoding: 'utf-8' });
  return { stdout, stderr, status };
};

/** A git repo with one commit of `files` */
const repo = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'cmdsync-git-'));
  sh(dir, 'git', 'init', '-q');
  sh(dir, 'git', 'config', 'user.email', 'test@example.com');
  sh(dir, 'git', 'config', 'user.name', 'test');
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(dir, name), content));
  sh(dir, 'git', 'add', '-A');
  sh(dir, 'git', 'commit', '-qm', 'init');
  return dir;
};

const staged = (dir: string) => sh(dir, 'git', 'diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean);

describe('--staged', () => {
  const doc = '<!-- CMDSYNC: cat version.txt -->\n<!-- /CMDSYNC -->\n';

  it('regenerates docs made stale by another staged file, and stages them', () => {
    const dir = repo({ 'version.txt': '1', 'README.md': doc.replace('-->\n<', '-->\n1\n<') });
    writeFileSync(join(dir, 'version.txt'), '2');
    sh(dir, 'git', 'add', 'version.txt');
    const { status } = sh(dir, tsx, cli, '--staged', '-q');
    assert.equal(status, 0);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf-8'), /-->\n2\n</);
    assert.deepEqual(staged(dir).sort(), ['README.md', 'version.txt']);
  });

  it('refuses to stage a stale file that has unstaged changes', () => {
    const dir = repo({ 'version.txt': '1', 'README.md': doc });
    writeFileSync(join(dir, 'README.md'), `${doc}wip\n`);
    const { status, stderr } = sh(dir, tsx, cli, '--staged', '-q');
    assert.equal(status, 1);
    assert.match(stderr, /README\.md is out of date but has unstaged changes/);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf-8'), `${doc}wip\n`);
    assert.deepEqual(staged(dir), []);
  });

  it('leaves untracked files alone', () => {
    const dir = repo({ 'version.txt': '1' });
    writeFileSync(join(dir, 'NEW.md'), doc);
    assert.equal(sh(dir, tsx, cli, '--staged', '-q').status, 0);
    assert.equal(readFileSync(join(dir, 'NEW.md'), 'utf-8'), doc);
    assert.deepEqual(staged(dir), []);
  });
});

describe('hookCommand', () => {
  it('picks the package manager from the lockfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-pm-'));
    assert.equal(hookCommand(dir), 'cmdsync --staged');
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(hookCommand(dir), 'npm exec -- cmdsync --staged');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    assert.equal(hookCommand(dir), 'pnpm exec cmdsync --staged');
    writeFileSync(join(dir, 'yarn.lock'), '');
    assert.equal(hookCommand(dir), 'yarn cmdsync --staged');
  });
});

describe('installHook', () => {
  it('creates a missing pre-commit hook, then reports it as installed', () => {
    const dir = repo({ 'package.json': '{}', 'yarn.lock': '' });
    const result = installHook(dir);
    assert.equal(result.kind, 'created');
    const file = join(dir, '.git', 'hooks', 'pre-commit');
    assert.equal(readFileSync(file, 'utf-8'), '#!/bin/sh\nyarn cmdsync --staged\n');
    assert.equal(installHook(dir).kind, 'already-installed');
  });

  it('prints the line to add to an existing hook instead of editing it', () => {
    const dir = repo({});
    const file = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(file, '#!/bin/sh\nmake lint\n');
    chmodSync(file, 0o755);
    assert.deepEqual(installHook(dir), { kind: 'manual', file, snippet: 'cmdsync --staged' });
    assert.equal(readFileSync(file, 'utf-8'), '#!/bin/sh\nmake lint\n');
  });

  it('writes to .husky/pre-commit when husky owns core.hooksPath', () => {
    const dir = repo({ 'package.json': '{}' });
    mkdirSync(join(dir, '.husky', '_'), { recursive: true });
    sh(dir, 'git', 'config', 'core.hooksPath', '.husky/_');
    assert.equal(installHook(dir).kind, 'created');
    assert.ok(existsSync(join(dir, '.husky', 'pre-commit')));
  });

  it('never writes a hook outside the repository (global core.hooksPath)', () => {
    const dir = repo({});
    const global = mkdtempSync(join(tmpdir(), 'cmdsync-global-hooks-'));
    sh(dir, 'git', 'config', 'core.hooksPath', global);
    assert.deepEqual(installHook(dir), { kind: 'manual', file: join(global, 'pre-commit'), snippet: 'cmdsync --staged' });
    assert.ok(!existsSync(join(global, 'pre-commit')));
  });

  it('defers to hook managers', () => {
    const dir = repo({ 'lefthook.yml': 'pre-commit:\n  commands: {}\n' });
    const result = installHook(dir);
    assert.equal(result.kind, 'manual');
    assert.match(result.kind === 'manual' ? result.snippet : '', /run: cmdsync --staged/);
    assert.ok(!existsSync(join(dir, '.git', 'hooks', 'pre-commit')));
  });
});
