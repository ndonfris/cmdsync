import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PATH_LIKE, completionScript } from '../src/completions.js';
import { OPTIONS, PARSE_OPTIONS, SHELLS } from '../src/options.js';

describe('OPTIONS', () => {
  it('matches the options the CLI parses', () => {
    assert.deepEqual(OPTIONS.map(o => o.long).sort(), Object.keys(PARSE_OPTIONS).sort());
    for (const o of OPTIONS) {
      const parsed: { type: string; short?: string; multiple?: boolean; } = PARSE_OPTIONS[o.long as keyof typeof PARSE_OPTIONS];
      assert.equal(parsed.type, o.value ? 'string' : 'boolean', o.long);
      assert.equal(parsed.short, o.short, o.long);
      assert.equal(!!parsed.multiple, !!o.multiple, o.long);
    }
  });
});

describe('completionScript', () => {
  for (const shell of SHELLS) {
    it(`completes every option and subcommand in ${shell}`, () => {
      const script = completionScript(shell);
      for (const o of OPTIONS) assert.ok(script.includes(o.long), `${shell} is missing --${o.long}`);
      assert.ok(script.includes('no-install'), `${shell} is missing --no-install`);
      assert.ok(script.includes('completions'));
      assert.ok(script.includes('lint'));
    });
  }
});

describe('file completion only for path-like tokens', () => {
  it('PATH_LIKE matches ./, ../, ~/, dir/ and dotfiles, not words', () => {
    for (const token of ['./', '../x', '~/', 'docs/', '.github', '/abs']) assert.match(token, PATH_LIKE, token);
    for (const token of ['', 'u', 'docs', 'README.md', '-']) assert.doesNotMatch(token, PATH_LIKE, token);
  });

  /** A directory with a few files, and the shell's completion script in it */
  const fixture = (shell: 'bash' | 'fish') => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    mkdirSync(join(dir, 'docs'));
    for (const file of ['README.md', 'docs/a.md']) writeFileSync(join(dir, file), '');
    writeFileSync(join(dir, `c.${shell}`), completionScript(shell));
    return dir;
  };
  const available = (bin: string) => spawnSync(bin, ['--version']).status === 0;

  it('bash: subcommands for `cmdsync <TAB>`, files only once the token looks like a path', () => {
    const dir = fixture('bash');
    const complete = (words: string[]) => spawnSync('bash', ['-c',
      `source ./c.bash; COMP_WORDS=(${words.map(w => `'${w}'`).join(' ')}); COMP_CWORD=${words.length - 1}; _cmdsync; printf '%s\\n' "\${COMPREPLY[@]}"`,
    ], { cwd: dir, encoding: 'utf-8' }).stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(complete(['cmdsync', '']), ['check', 'completions', 'hook', 'init', 'lint', 'migrate', 'repos', 'status', 'update']);
    assert.deepEqual(complete(['cmdsync', 'R']), []);
    assert.deepEqual(complete(['cmdsync', './R']), ['./README.md']);
    assert.deepEqual(complete(['cmdsync', 'docs/']), ['docs/a.md']);
    assert.deepEqual(complete(['cmdsync', 'update', '']), []);
    assert.deepEqual(complete(['cmdsync', '--config', 'R']), ['README.md'], 'a file option always completes files');
  });

  it('fish: the same', { skip: !available('fish') && 'fish is not installed' }, () => {
    const dir = fixture('fish');
    const complete = (line: string) => spawnSync('fish', ['--no-config', '-c', `source c.fish; complete -C ${JSON.stringify(line)}`], { cwd: dir, encoding: 'utf-8' })
      .stdout.split('\n').filter(Boolean).map(l => l.split('\t')[0]!).sort();
    assert.deepEqual(complete('cmdsync '), ['check', 'completions', 'hook', 'init', 'lint', 'migrate', 'repos', 'status', 'update']);
    assert.deepEqual(complete('cmdsync ./R'), ['./README.md']);
    assert.deepEqual(complete('cmdsync docs/'), ['docs/a.md']);
    assert.deepEqual(complete('cmdsync update '), []);
    assert.deepEqual(complete('cmdsync --config R'), ['README.md']);
  });
});
