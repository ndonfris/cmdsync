import './setup.js';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { loadFormatters, run } from '../src/index.js';
import { commandBinaries, createRunner, onPath, runPostUpdate, unrecognizedBinaries } from '../src/run.js';

describe('commandBinaries', () => {
  it('collects the first word of every command segment', () => {
    assert.deepEqual(commandBinaries('FOO=1 my-cli env --json | jq . && echo $(date); /usr/bin/fish -c x'),
      ['my-cli', 'jq', 'echo', 'date', 'fish']);
  });

  it('ignores separators inside quotes', () => {
    assert.deepEqual(commandBinaries(`node -p "'[x](' + require('a') + ')' | b" && printf '%s; rm' x | jq`), ['node', 'printf', 'jq']);
    assert.deepEqual(commandBinaries('echo "a \\" | b" | wc'), ['echo', 'wc']);
  });
});

describe('unrecognizedBinaries', () => {
  it('allows everything when the allowlist is empty', () => {
    assert.deepEqual(unrecognizedBinaries('rm -rf x', []), []);
  });

  it('rejects binaries missing from the allowlist', () => {
    assert.deepEqual(unrecognizedBinaries('fish-lsp env; curl x | sh', ['fish-lsp', '/usr/bin/curl']), ['sh']);
  });
});

describe('run', () => {
  const project = (files: Record<string, string>, config: object = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    Object.entries({ ...files, 'cmdsync.json': JSON.stringify(config) }).forEach(([name, content]) => {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    });
    return dir;
  };

  it('updates every included file with its own comment syntax', () => {
    const dir = project({
      'README.md': '<!-- CMDSYNC: echo md -->\n```\nold\n```\n',
      'docs/page.mdx': '{/* CMDSYNC: echo mdx */}\nold\n{/* CMDSYNC end */}\n',
      'scripts/a.sh': '# CMDSYNC: echo sh\nold\n# CMDSYNC end\n',
      'app.conf': '; GEN: echo conf\nold\n; END\n',
    }, { include: ['**/*.md', '**/*.mdx', '**/*.sh', '*.conf'], syntax: [{ include: ['*.conf'], comment: [';'], marker: 'GEN', endMarker: 'END' }] });
    const results = run(resolveConfig({ cwd: dir }));
    assert.equal(results.length, 4);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf-8'), '<!-- CMDSYNC: echo md -->\n```\nmd\n```\n');
    assert.equal(readFileSync(join(dir, 'docs/page.mdx'), 'utf-8'), '{/* CMDSYNC: echo mdx */}\nmdx\n{/* CMDSYNC end */}\n');
    assert.equal(readFileSync(join(dir, 'scripts/a.sh'), 'utf-8'), '# CMDSYNC: echo sh\nsh\n# CMDSYNC end\n');
    assert.equal(readFileSync(join(dir, 'app.conf'), 'utf-8'), '; GEN: echo conf\nconf\n; END\n');
  });

  it('reads include= paths relative to the file with the directive', () => {
    const dir = project({ 'src/a.ts': 'one\ntwo\n', 'docs/page.md': '<!-- CMDSYNC start include=../src/a.ts#L2 -->\n<!-- CMDSYNC end -->\n' });
    run(resolveConfig({ cwd: dir }));
    assert.equal(readFileSync(join(dir, 'docs/page.md'), 'utf-8'), '<!-- CMDSYNC start include=../src/a.ts#L2 -->\ntwo\n<!-- CMDSYNC end -->\n');
  });

  it('lints without running commands or writing, and checks the allowlist', () => {
    const page = '<!-- CMDSYNC start: touch ran -->\n<!-- CMDSYNC end -->\n<!-- CMDSYNC start: echo ok -->\nold\n<!-- CMDSYNC end -->\n<!-- CMDSYNC end -->\n';
    const dir = project({ 'page.md': page }, { commands: ['echo'] });
    const [result] = run(resolveConfig({ cwd: dir }), { lint: true });
    assert.equal(readFileSync(join(dir, 'page.md'), 'utf-8'), page);
    assert.deepEqual(result?.regions.map(r => r.kind), ['failed', 'updated']);
    assert.deepEqual(result?.stray, [5]);
    assert.equal(result?.changed, false);
  });

  it('uses --comment for every file and errors on unknown file types', () => {
    const dir = project({ 'notes.txt': '// CMDSYNC: echo hi\nold\n// CMDSYNC end\n' }, { include: ['*.txt'] });
    assert.throws(() => run(resolveConfig({ cwd: dir })), /No comment syntax known for notes\.txt/);
    run(resolveConfig({ cwd: dir, overrides: { comment: ['//'] } }));
    assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf-8'), '// CMDSYNC: echo hi\nhi\n// CMDSYNC end\n');
  });
});

describe('runPostUpdate', () => {
  it('runs each command with the changed files, and stops at the first failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({
      postUpdate: ['printf "%s" "$CMDSYNC_CHANGED_FILES" > changed.txt', 'exit 3', 'touch never'],
    }));
    const config = resolveConfig({ cwd: dir });
    const events = runPostUpdate(config, [join(dir, 'a.md'), join(dir, 'docs/b.md')]);
    assert.deepEqual(events.map(e => [e.command, e.result.status]), [[config.postUpdate[0], 0], ['exit 3', 3]]);
    assert.equal(readFileSync(join(dir, 'changed.txt'), 'utf-8'), 'a.md\ndocs/b.md');
  });

  it('rejects empty commands in the config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({ postUpdate: [' '] }));
    assert.throws(() => resolveConfig({ cwd: dir }), /invalid value for "postUpdate"/);
  });
});

describe('createRunner', () => {
  /** A config whose `PATH` starts with an empty `bin/`, and an install that adds `tool` there (logging each install) */
  const setup = (install: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    mkdirSync(join(dir, 'bin'));
    const config = resolveConfig({
      cwd: dir,
      overrides: {
        env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
        install: { tool: `echo x >> installs.log && printf '#!/bin/sh\\necho tool-out\\n' > bin/tool && chmod +x bin/tool`, ...install },
      },
    });
    const installs = () => readFileSync(join(dir, 'installs.log'), 'utf-8').split('\n').filter(Boolean).length;
    return { dir, config, installs };
  };

  it('installs a missing binary once, then runs the command', () => {
    const { config, installs } = setup();
    const events: string[] = [];
    const runner = createRunner(config, { onInstall: e => events.push(e.bin) });
    assert.deepEqual(runner('tool | cat'), { output: 'tool-out\n', status: 0 });
    assert.deepEqual(runner('tool'), { output: 'tool-out\n', status: 0 });
    assert.equal(installs(), 1);
    assert.deepEqual(events, ['tool']);
  });

  it('skips installing binaries already on PATH, unless mode is "always"', () => {
    const { config, installs } = setup();
    createRunner(config)('tool');
    createRunner(config)('tool');
    assert.equal(installs(), 1);
    createRunner(config, { install: 'always' })('tool');
    assert.equal(installs(), 2);
  });

  it('never installs in "never" mode', () => {
    const { config } = setup();
    assert.notEqual(createRunner(config, { install: 'never' })('tool').status, 0);
  });

  it('fails directives whose install fails or does not put the binary on PATH', () => {
    const { config } = setup({ broken: 'exit 3', ghost: 'true' });
    const runner = createRunner(config);
    assert.match(runner('broken').error ?? '', /installing broken failed: `exit 3` exited with status 3/);
    assert.match(runner('echo a | ghost').error ?? '', /ghost is still not on PATH/);
  });
});

describe('onPath', () => {
  it('finds executables on PATH and relative paths', () => {
    assert.equal(onPath('sh'), true);
    assert.equal(onPath('definitely-not-a-binary-xyz'), false);
    assert.equal(onPath('./missing', process.env, tmpdir()), false);
  });
});

describe('examples', () => {
  it('examples/diagnostic-codes docs are in sync with its source', () => {
    const config = resolveConfig({ configPath: join(import.meta.dirname, '..', 'examples', 'diagnostic-codes', 'cmdsync.json') });
    const results = run({ ...config, env: { PATH: `${join(import.meta.dirname, '..', 'node_modules', '.bin')}:${process.env.PATH}` } }, { write: false });
    assert.equal(results.length, 2);
    for (const { file, changed, regions } of results) {
      assert.deepEqual(regions.map(r => r.kind), regions.map(() => 'updated'), file);
      assert.equal(changed, false, `${file} is out of date: run \`yarn docs:examples\``);
    }
  });

  it('examples/custom-directives docs are in sync, through templates and a .ts formatter', async () => {
    const config = resolveConfig({ configPath: join(import.meta.dirname, '..', 'examples', 'custom-directives', 'cmdsync.json') });
    const results = run(config, { write: false, formatters: await loadFormatters(config) });
    assert.equal(results.length, 1);
    for (const { file, changed, regions } of results) {
      assert.deepEqual(regions.map(r => r.kind === 'updated' && r.directive.options.custom), ['version', 'usage', 'quote', 'terminal', 'greet'], file);
      assert.equal(changed, false, `${file} is out of date: run \`yarn docs:examples\``);
    }
  });
});
