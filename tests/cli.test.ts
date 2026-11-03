import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');

/** Run the CLI from source in `cwd`, with `input` on stdin, isolated from any global config */
const cmdsync = (cwd: string, args: string[], input = '', env: Record<string, string> = {}) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd,
  input,
  encoding: 'utf-8',
  // never the user's real editor
  env: { ...process.env, CMDSYNC_GLOBAL_CONFIG: join(cwd, 'no-global.json'), NO_COLOR: '1', VISUAL: 'false', EDITOR: 'false', ...env },
});

const temp = () => mkdtempSync(join(tmpdir(), 'cmdsync-'));

describe('cmdsync --interactive', () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({ postUpdate: ['echo "post:$CMDSYNC_CHANGED_FILES" > post.txt'] }));
    writeFileSync(join(dir, 'a.md'), '<!-- CMDSYNC start: echo A -->\na\n<!-- CMDSYNC end -->\n\n<!-- CMDSYNC start: echo B -->\nb\n<!-- CMDSYNC end -->\n');
    writeFileSync(join(dir, 'b.md'), '<!-- CMDSYNC start: echo C -->\nc\n<!-- CMDSYNC end -->\n');
    return dir;
  };

  it('writes only the accepted changes, then runs postUpdate for the written files', () => {
    const dir = project();
    const { status, stdout } = cmdsync(dir, ['-i'], '?\nn\ny\nn\n');
    assert.equal(status, 0, stdout);
    assert.match(stdout, /a - apply this change and every later one in the file/);
    assert.match(stdout, /a\.md:6 {2}echo B {2}\(2\/2\)/);
    assert.equal(readFileSync(join(dir, 'a.md'), 'utf-8'), '<!-- CMDSYNC start: echo A -->\na\n<!-- CMDSYNC end -->\n\n<!-- CMDSYNC start: echo B -->\nB\n<!-- CMDSYNC end -->\n');
    assert.equal(readFileSync(join(dir, 'b.md'), 'utf-8'), '<!-- CMDSYNC start: echo C -->\nc\n<!-- CMDSYNC end -->\n');
    assert.equal(readFileSync(join(dir, 'post.txt'), 'utf-8'), 'post:a.md\n');
  });

  it('`a` applies the rest of the file, and `q` (or the end of input) skips everything left', () => {
    const dir = project();
    cmdsync(dir, ['update', '--interactive'], 'a\nq\n');
    assert.match(readFileSync(join(dir, 'a.md'), 'utf-8'), /^A$[\s\S]*^B$/m);
    assert.match(readFileSync(join(dir, 'b.md'), 'utf-8'), /^c$/m);
    const untouched = project();
    assert.equal(cmdsync(untouched, ['-i']).status, 0);
    assert.match(readFileSync(join(untouched, 'a.md'), 'utf-8'), /^a$/m);
  });

  it('refuses modes that never write', () => {
    for (const args of [['-i', '--check'], ['status', '-i'], ['-i', '--diff'], ['lint', '-i']]) {
      assert.equal(cmdsync(project(), args).status, 2, args.join(' '));
    }
  });
});

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
    const edited = cmdsync(dir, ['--edit', '--show'], '', { VISUAL: 'cp good.json', EDITOR: 'false' });
    assert.equal(edited.status, 0, edited.stderr);
    assert.equal(edited.stdout, '{"marker":"DOCS"}\n');
    const invalid = cmdsync(dir, ['--edit'], '', { VISUAL: '', EDITOR: 'cp bad.json' });
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
