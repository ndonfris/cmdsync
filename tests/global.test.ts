import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { contractHome, globalConfigPath, loadGlobalConfig, selectRepos, validateGlobalConfig } from '../src/global.js';
import { addRepo, initConfig, initGlobal, removeRepo } from '../src/init.js';

const temp = () => mkdtempSync(join(tmpdir(), 'cmdsync-'));

describe('globalConfigPath', () => {
  it('prefers CMDSYNC_GLOBAL_CONFIG, then XDG_CONFIG_HOME, then ~/.config', () => {
    assert.equal(globalConfigPath({ CMDSYNC_GLOBAL_CONFIG: '/x/c.json', XDG_CONFIG_HOME: '/xdg' }), '/x/c.json');
    assert.equal(globalConfigPath({ XDG_CONFIG_HOME: '/xdg' }), '/xdg/cmdsync/config.json');
    assert.equal(globalConfigPath({}), join(homedir(), '.config/cmdsync/config.json'));
  });
});

describe('validateGlobalConfig', () => {
  it('validates defaults like a repository config, and repos', () => {
    assert.throws(() => validateGlobalConfig({ defaults: { nope: 1 } }, 'g'), /g#defaults: unknown config key "nope"/);
    assert.throws(() => validateGlobalConfig({ repos: [{ path: '' }] }, 'g'), /invalid repos\[0\]/);
    assert.throws(() => validateGlobalConfig({ repos: [{ path: '/a/x' }, { path: '/b/x' }] }, 'g'), /two repos are named "x"/);
    assert.throws(() => validateGlobalConfig({ repo: [] }, 'g'), /unknown global config key "repo"/);
  });
});

describe('selectRepos', () => {
  const config = { repos: [{ path: '/r/a', groups: ['docs'] }, { path: '/r/b', name: 'bee', groups: ['docs', 'fish'] }, { path: '/r/c' }] };
  it('picks by --all, --group and --repo (name or path), in config order', () => {
    assert.equal(selectRepos(config, { all: true }).length, 3);
    assert.deepEqual(selectRepos(config, { groups: ['fish'], repos: ['/r/a'] }).map(r => r.path), ['/r/a', '/r/b']);
    assert.deepEqual(selectRepos(config, { repos: ['bee', 'c'] }).map(r => r.path), ['/r/b', '/r/c']);
  });
  it('rejects groups and repos that match nothing', () => {
    assert.throws(() => selectRepos(config, { groups: ['nope'] }), /no repos in group "nope"/);
    assert.throws(() => selectRepos(config, { repos: ['b'] }), /no repo named "b"/);
  });
});

describe('global defaults', () => {
  it('apply under the repository config, merging install and env by key', () => {
    const dir = temp();
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({ shell: 'bash', env: { A: 'repo' }, install: { x: 'repo-x' } }));
    const config = resolveConfig({
      cwd: dir,
      defaults: { shell: 'fish', timeout: 5, env: { A: 'global', B: 'global' }, install: { x: 'global-x', y: 'global-y' } },
      overrides: { env: { C: 'cli' } },
    });
    assert.equal(config.shell, 'bash');
    assert.equal(config.timeout, 5);
    assert.deepEqual(config.env, { A: 'repo', B: 'global', C: 'cli' });
    assert.deepEqual(config.install, { x: 'repo-x', y: 'global-y' });
  });
});

describe('init', () => {
  it('creates cmdsync.json once, and refuses to shadow an update-codeblocks config', () => {
    const dir = temp();
    assert.equal(initConfig(dir).kind, 'created');
    assert.ok(JSON.parse(readFileSync(join(dir, 'cmdsync.json'), 'utf-8')).$schema);
    assert.equal(initConfig(dir).kind, 'exists');
    const legacy = temp();
    writeFileSync(join(legacy, 'package.json'), JSON.stringify({ 'update-codeblocks': {} }));
    assert.deepEqual(initConfig(legacy), { kind: 'legacy', file: join(legacy, 'package.json#update-codeblocks') });
  });

  it('adds the key to package.json, keeping its indentation', () => {
    const dir = temp();
    writeFileSync(join(dir, 'package.json'), '{\n    "name": "x"\n}\n');
    initConfig(dir, { packageJson: true });
    const text = readFileSync(join(dir, 'package.json'), 'utf-8');
    assert.match(text, /^ {4}"cmdsync": \{$/m);
    assert.deepEqual(resolveConfig({ cwd: dir }).include, ['**/*.md', '**/*.mdx']);
  });

  it('init global creates the file, and adds repositories once', () => {
    const path = join(temp(), 'nested/config.json');
    const repo = join(temp(), 'a');
    mkdirSync(repo);
    assert.deepEqual(initGlobal({ path }), { file: path, created: true, added: false });
    assert.deepEqual(initGlobal({ path, add: { path: repo } }), { file: path, created: false, added: true });
    assert.deepEqual(initGlobal({ path, add: { path: repo } }), { file: path, created: false, added: false });
    const config = loadGlobalConfig(path)!;
    assert.deepEqual(config.repos, [{ path: repo }]);
    assert.throws(() => addRepo(config, { path: '/other/a' }), /a repo named "a" is already/);
    assert.equal(removeRepo(config, 'a')?.path, repo);
    assert.deepEqual(config.repos, []);
  });

  it('contractHome writes paths under $HOME with ~', () => {
    assert.equal(contractHome(join(homedir(), 'repos/a')), '~/repos/a');
    assert.equal(contractHome('/opt/a'), '/opt/a');
  });
});
