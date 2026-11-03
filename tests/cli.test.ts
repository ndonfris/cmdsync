import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');

/** Run the CLI from source in `cwd`, isolated from any global config, and never with the user's real editor */
const cmdsync = (cwd: string, args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd,
  input: '',
  encoding: 'utf-8',
  env: { ...process.env, CMDSYNC_GLOBAL_CONFIG: join(cwd, 'no-global.json'), NO_COLOR: '1', VISUAL: 'false', EDITOR: 'false', ...env },
});

const temp = () => mkdtempSync(join(tmpdir(), 'cmdsync-'));

describe('cmdsync --show / --edit', () => {
  it('--show prints cmdsync.json as is, or the "cmdsync" key of package.json', () => {
    const dir = temp();
    writeFileSync(join(dir, 'package.json'), '{"name":"x","cmdsync":{"shell":"bash"}}');
    assert.equal(cmdsync(dir, ['--show']).stdout, '{\n  "shell": "bash"\n}\n');
    writeFileSync(join(dir, 'other.json'), '{ "marker": "X" }');
    const shown = cmdsync(dir, ['--config', 'other.json', '--show']);
    assert.equal(shown.stdout, '{ "marker": "X" }\n');
    assert.match(shown.stderr, /other\.json/);
  });

  it('--edit opens $VISUAL (over $EDITOR) on the file, then validates it', () => {
    const dir = temp();
    writeFileSync(join(dir, 'cmdsync.json'), '{}');
    writeFileSync(join(dir, 'good.json'), '{"marker":"DOCS"}');
    writeFileSync(join(dir, 'bad.json'), '{"nope":1}');
    const edited = cmdsync(dir, ['--edit', '--show'], { VISUAL: 'cp good.json', EDITOR: 'false' });
    assert.equal(edited.status, 0, edited.stderr);
    assert.equal(edited.stdout, '{"marker":"DOCS"}\n');
    const invalid = cmdsync(dir, ['--edit'], { VISUAL: '', EDITOR: 'cp bad.json' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /the config is invalid now: .*unknown config key "nope"/);
    assert.equal(cmdsync(dir, ['--edit']).status, 2, 'an editor that fails');
  });

  it('needs a config, and takes no commands or paths', () => {
    assert.match(cmdsync(temp(), ['--show']).stderr, /no cmdsync\.json or package\.json "cmdsync" key found/);
    const dir = temp();
    writeFileSync(join(dir, 'cmdsync.json'), '{}');
    assert.equal(cmdsync(dir, ['check', '--show']).status, 2);
    assert.equal(cmdsync(dir, ['--show', 'README.md']).status, 2);
  });
});
