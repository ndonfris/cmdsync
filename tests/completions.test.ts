import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PATH_LIKE, complete } from '../src/complete.ts';
import { completionScript } from '../src/completions.ts';
import { OPTIONS, OPTION_CONTEXTS, PARSE_OPTIONS, SHELLS } from '../src/options.ts';

describe('OPTIONS', () => {
  it('matches the options the CLI parses, and says where each is accepted', () => {
    assert.deepEqual(OPTIONS.map(o => o.long).sort(), Object.keys(PARSE_OPTIONS).sort());
    for (const o of OPTIONS) {
      const parsed: { type: string; short?: string; multiple?: boolean; } = PARSE_OPTIONS[o.long as keyof typeof PARSE_OPTIONS];
      assert.equal(parsed.type, o.value ? 'string' : 'boolean', o.long);
      assert.equal(parsed.short, o.short, o.long);
      assert.equal(!!parsed.multiple, !!o.multiple, o.long);
      assert.ok(OPTION_CONTEXTS[o.long]?.length, `no OPTION_CONTEXTS for --${o.long}`);
    }
  });
});

/** The values `complete()` suggests for `cmdsync <line>` (the last word is the one being completed) */
const at = (line: string) => {
  const words = line.split(' ');
  const { values, then } = complete(words);
  return { values: values.map(v => v.value), then };
};

describe('complete', () => {
  it('cmdsync <TAB> is the subcommands; a path-like word adds files', () => {
    assert.deepEqual(at('').values, ['update', 'status', 'check', 'completions', 'hook', 'init', 'repos', 'migrate', 'lint']);
    assert.equal(at('').then, undefined);
    assert.equal(at('./').then, 'files');
  });

  it('cmdsync <subcommand> <TAB> is the options usable there', () => {
    const update = at('update ').values;
    assert.ok(update.includes('--config') && update.includes('--interactive') && update.includes('--staged'));
    for (const no of ['--check', '--dry-run', '--diff', '--show', '--help']) assert.ok(!update.includes(no), `update offers ${no}`);
    const check = at('check -').values;
    assert.ok(check.includes('--diff'));
    for (const no of ['--check', '--staged', '--interactive', '--post-update-cmds']) assert.ok(!check.includes(no), `check offers ${no}`);
    const lint = at('lint ').values;
    for (const no of ['--install', '--staged', '--diff', '--post-update-cmds']) assert.ok(!lint.includes(no), `lint offers ${no}`);
    assert.deepEqual(at('migrate ').values, ['--dry-run', '--diff', '--quiet', '--from']);
  });

  it('hides options already given (unless repeatable), and ones that conflict with them', () => {
    const staged = at('--staged ').values;
    for (const no of ['--staged', '--check', '--dry-run', '--diff', '--interactive', '--all', '--group', '--repo', '--show', '--help']) {
      assert.ok(!staged.includes(no), `--staged offers ${no}`);
    }
    assert.ok(staged.includes('--config'));
    assert.ok(!at('-q ').values.includes('--verbose'));
    assert.ok(!at('--install ').values.includes('--no-install'));
    assert.ok(!at('--config x ').values.includes('--all'));
    assert.ok(at('--command x ').values.includes('--command'), 'repeatable');
    const show = at('--show ').values;
    assert.ok(show.includes('--resolved') && show.includes('--config') && !show.includes('--check'));
  });

  it('after an option that takes a value, only its values: --config <TAB> is files', () => {
    assert.deepEqual(at('--config '), { values: [], then: 'files' });
    assert.deepEqual(at('update -c '), { values: [], then: 'files' });
    assert.deepEqual(at('--shell '), { values: [], then: 'commands' });
    assert.deepEqual(at('--marker '), { values: [], then: undefined });
    assert.deepEqual(at('--config=').then, 'files');
    assert.ok(at('--config x ').values.includes('--check'), 'options again once the value is there');
  });

  it('short options for a short word, and subcommand arguments', () => {
    assert.ok(at('-c').values.includes('-c'));
    assert.deepEqual(at('completions ').values, ['bash', 'zsh', 'fish', 'nu']);
    assert.deepEqual(at('repos ').values, ['list', 'add', 'remove']);
    assert.deepEqual(at('repos add '), { values: ['--name', '--group'], then: 'files' });
    assert.deepEqual(at('init ').values, ['global', '--package-json']);
    assert.deepEqual(at('init global ').values, ['--add', '--name', '--group']);
    assert.deepEqual(at('hook ').values, ['install']);
  });

  it('PATH_LIKE matches ./, ../, ~/, dir/ and dotfiles, not words', () => {
    for (const token of ['./', '../x', '~/', 'docs/', '.github', '/abs']) assert.match(token, PATH_LIKE, token);
    for (const token of ['', 'u', 'docs', 'README.md', '-']) assert.doesNotMatch(token, PATH_LIKE, token);
  });
});

describe('completionScript', () => {
  it('bash, zsh and fish ask `cmdsync __complete`; nu declares every option for its parser', () => {
    for (const shell of ['bash', 'zsh', 'fish'] as const) assert.match(completionScript(shell), /cmdsync __complete/, shell);
    const nu = completionScript('nu');
    assert.match(nu, /\^cmdsync __complete/);
    for (const o of OPTIONS) assert.ok(nu.includes(`--${o.long}`), `nu is missing --${o.long}`);
    assert.match(nu, /export extern "cmdsync update" \[[^\]]*--staged/);
    assert.doesNotMatch(nu.match(/export extern "cmdsync update" \[[^\]]*\]/)![0], /--check/);
    assert.equal(SHELLS.length, 4);
  });

  /** A project with a few files, the shell's script, and a `cmdsync` on PATH that runs the source */
  const fixture = (shell: 'bash' | 'fish') => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'bin'));
    for (const file of ['README.md', 'docs/a.md']) writeFileSync(join(dir, file), '');
    writeFileSync(join(dir, `c.${shell}`), completionScript(shell));
    const bin = join(dir, 'bin', 'cmdsync');
    writeFileSync(bin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(import.meta.dirname, '..', 'src', 'cli.ts'))} "$@"\n`);
    chmodSync(bin, 0o755);
    return { dir, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CMDSYNC_GLOBAL_CONFIG: join(dir, 'none.json') } };
  };
  const available = (bin: string) => spawnSync(bin, ['--version']).status === 0;

  it('bash completes what __complete says, at each position', () => {
    const { dir, env } = fixture('bash');
    const complete = (...words: string[]) => spawnSync('bash', ['-c',
      `source ./c.bash; COMP_WORDS=(cmdsync ${words.map(w => `'${w}'`).join(' ')}); COMP_CWORD=${words.length}; _cmdsync; printf '%s\\n' "\${COMPREPLY[@]}"`,
    ], { cwd: dir, env, encoding: 'utf-8' }).stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(complete(''), ['check', 'completions', 'hook', 'init', 'lint', 'migrate', 'repos', 'status', 'update']);
    assert.ok(complete('update', '').includes('--staged'));
    assert.ok(!complete('update', '').includes('--check'));
    assert.ok(!complete('--staged', '--').includes('--check'));
    assert.deepEqual(complete('--config', 'R'), ['README.md'], 'only files after --config');
    assert.deepEqual(complete('docs/'), ['docs/a.md']);
    assert.deepEqual(complete('R'), []);
  });

  it('fish completes the same', { skip: !available('fish') && 'fish is not installed' }, () => {
    const { dir, env } = fixture('fish');
    const complete = (line: string) => spawnSync('fish', ['--no-config', '-c', `source c.fish; complete -C ${JSON.stringify(line)}`], { cwd: dir, env, encoding: 'utf-8' })
      .stdout.split('\n').filter(Boolean).map(l => l.split('\t')[0]!).sort();
    assert.deepEqual(complete('cmdsync '), ['check', 'completions', 'hook', 'init', 'lint', 'migrate', 'repos', 'status', 'update']);
    assert.ok(complete('cmdsync update ').includes('--staged'));
    assert.ok(!complete('cmdsync update ').includes('--check'));
    assert.deepEqual(complete('cmdsync --config R'), ['README.md']);
    assert.deepEqual(complete('cmdsync docs/'), ['docs/a.md']);
  });
});
