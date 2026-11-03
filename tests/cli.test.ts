import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  it('--resolved shows the merged config, marking where each value is from', () => {
    const dir = temp();
    writeFileSync(join(dir, 'global.json'), JSON.stringify({ defaults: { shell: 'fish', env: { A: 'global', B: 'global' } } }));
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({ env: { A: 'local' } }));
    const { status, stdout, stderr } = cmdsync(dir, ['--show', '--resolved', '-m', 'DOCS'], '', { CMDSYNC_GLOBAL_CONFIG: join(dir, 'global.json') });
    assert.equal(status, 0, stderr);
    assert.match(stdout, /^ {2}"marker": "DOCS", {2}\/\/ flag$/m);
    assert.match(stdout, /^ {2}"shell": "fish", {2}\/\/ global$/m);
    assert.match(stdout, /^ {4}"A": "local", {2}\/\/ config$/m);
    assert.match(stdout, /^ {4}"B": "global" {2}\/\/ global$/m);
    assert.match(stdout, /^ {2}"include": \["\*\*\/\*\.md","\*\*\/\*\.mdx"\], {2}\/\/ default$/m);
    assert.match(stderr, /global: .*global\.json/);
    // without any config file, it's the defaults
    assert.equal(cmdsync(temp(), ['--resolved']).status, 0);
  });

  it('needs a config, and takes no commands or paths', () => {
    assert.match(cmdsync(temp(), ['--show']).stderr, /no cmdsync\.json or package\.json "cmdsync" key found/);
    const dir = temp();
    writeFileSync(join(dir, 'cmdsync.json'), '{}');
    assert.equal(cmdsync(dir, ['check', '--show']).status, 2);
    assert.equal(cmdsync(dir, ['--show', 'README.md']).status, 2);
  });
});

/** A project directory with `files`, and `cmdsync.json` unless one is given */
const project = (files: Record<string, string>) => {
  const dir = temp();
  for (const [name, content] of Object.entries({ 'cmdsync.json': '{}', ...files })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf-8');
const stale = '<!-- CMDSYNC start: echo new -->\nold\n<!-- CMDSYNC end -->\n';
const fresh = '<!-- CMDSYNC start: echo new -->\nnew\n<!-- CMDSYNC end -->\n';

describe('cmdsync update / check / status / --diff / --dry-run', () => {
  it('update writes stale regions and reports them; a second run changes nothing', () => {
    const dir = project({ 'a.md': stale, 'docs/b.md': fresh });
    const first = cmdsync(dir, []);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^✎ a\.md$/m);
    assert.match(first.stdout, /^ {4}updated {2}a\.md:1 {2}echo new$/m);
    assert.match(first.stdout, /^✓ docs\/b\.md$/m);
    assert.match(first.stdout, /2 file\(s\), 2 directive\(s\), 1 region\(s\) updated/);
    assert.equal(read(dir, 'a.md'), fresh);
    assert.match(cmdsync(dir, ['update']).stdout, /0 region\(s\) updated/);
  });

  it('check and --check exit 1 on stale regions without writing, 0 when up to date', () => {
    const dir = project({ 'a.md': stale });
    for (const args of [['check'], ['--check']]) {
      const { status, stdout } = cmdsync(dir, args);
      assert.equal(status, 1, args.join(' '));
      assert.match(stdout, /outdated {2}a\.md:1/);
    }
    assert.equal(read(dir, 'a.md'), stale);
    writeFileSync(join(dir, 'a.md'), fresh);
    assert.equal(cmdsync(dir, ['check']).status, 0);
  });

  it('--diff prints the diff and exits 1; status prints it and exits 0; --dry-run only reports', () => {
    const dir = project({ 'a.md': stale });
    const diff = cmdsync(dir, ['--diff', '-q']);
    assert.equal(diff.status, 1);
    assert.equal(diff.stdout, '\n--- a/a.md\n+++ b/a.md\n@@ -1,3 +1,3 @@\n <!-- CMDSYNC start: echo new -->\n-old\n+new\n <!-- CMDSYNC end -->\n\n');
    const status = cmdsync(dir, ['status', '-q']);
    assert.equal(status.status, 0);
    assert.equal(status.stdout, diff.stdout);
    const dry = cmdsync(dir, ['--dry-run']);
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /1 region\(s\) out of date/);
    assert.equal(read(dir, 'a.md'), stale);
  });

  it('failed commands and invalid directives exit 1, keep their content, and say why', () => {
    const dir = project({ 'a.md': '<!-- CMDSYNC start: echo out; exit 3 -->\nold\n<!-- CMDSYNC end -->\n<!-- CMDSYNC strat: x -->\n' });
    const { status, stderr } = cmdsync(dir, []);
    assert.equal(status, 1);
    assert.match(stderr, /failed {2}a\.md:1 {2}echo out; exit 3\n {12}exited with status 3\n {12}│ out/);
    assert.match(stderr, /invalid a\.md:4 {2}unknown mode "strat"/);
    assert.match(read(dir, 'a.md'), /^old$/m);
  });

  it('only processes the paths given', () => {
    const dir = project({ 'a.md': stale, 'b.md': stale });
    cmdsync(dir, ['b.md']);
    assert.equal(read(dir, 'a.md'), stale);
    assert.equal(read(dir, 'b.md'), fresh);
  });

  it('--verbose shows the config, every file scanned and every command with its time', () => {
    const { stdout } = cmdsync(project({ 'a.md': stale, 'c.md': '# none\n' }), ['--verbose', '--dry-run']);
    assert.match(stdout, /^include: \*\*\/\*\.md \*\*\/\*\.mdx {2}exclude: /m);
    assert.match(stdout, /^ {2}scan {2}a\.md {2}\(<!-- -->, markdown\)$/m);
    assert.match(stdout, /^ {2}scan {2}c\.md/m);
    assert.match(stdout, /^ {2}\$ echo new {2}→ exit 0 in \d+ms$/m);
  });

  it('flags that contradict each other are usage errors (exit 2)', () => {
    const dir = project({ 'a.md': stale });
    for (const args of [['update', '--diff'], ['update', '--check'], ['status', '--check'], ['--staged', '--check'], ['-q', '--verbose'], ['--check', '--post-update-cmds'], ['--nope']]) {
      const { status, stderr } = cmdsync(dir, args);
      assert.equal(status, 2, `${args.join(' ')}: ${stderr}`);
      assert.match(stderr, /^cmdsync: /);
    }
    assert.equal(read(dir, 'a.md'), stale);
  });

  it('--help and --version', () => {
    assert.match(cmdsync(temp(), ['--help']).stdout, /^Usage: cmdsync \[update\] \[options\] \[paths\.\.\.\]/);
    assert.match(cmdsync(temp(), ['-v']).stdout, /^\d+\.\d+\.\d+\n$/);
  });
});

describe('cmdsync postUpdate', () => {
  const config = (postUpdate: string[]) => JSON.stringify({ postUpdate });

  it('runs after an update that wrote files, with them in CMDSYNC_CHANGED_FILES', () => {
    const dir = project({ 'cmdsync.json': config(['printf "%s" "$CMDSYNC_CHANGED_FILES" > changed.txt']), 'a.md': stale, 'b.md': fresh });
    const { status, stdout } = cmdsync(dir, []);
    assert.equal(status, 0);
    assert.match(stdout, /^postUpdate {2}printf/m);
    assert.equal(read(dir, 'changed.txt'), 'a.md');
  });

  it('is skipped when nothing changed (unless --post-update-cmds), and never with --no-post-update-cmds', () => {
    const dir = project({ 'cmdsync.json': config(['touch ran']), 'a.md': fresh });
    cmdsync(dir, []);
    assert.throws(() => read(dir, 'ran'));
    cmdsync(dir, ['--post-update-cmds']);
    assert.equal(read(dir, 'ran'), '');
    const other = project({ 'cmdsync.json': config(['touch ran']), 'a.md': stale });
    cmdsync(other, ['--no-post-update-cmds']);
    assert.throws(() => read(other, 'ran'));
  });

  it('a failing command stops the rest and exits 1', () => {
    const dir = project({ 'cmdsync.json': config(['echo broke >&2; exit 4', 'touch never']), 'a.md': stale });
    const { status, stderr } = cmdsync(dir, []);
    assert.equal(status, 1);
    assert.match(stderr, /postUpdate failed {2}echo broke >&2; exit 4\n {12}exited with status 4\n {12}│ broke/);
    assert.throws(() => read(dir, 'never'));
    assert.equal(read(dir, 'a.md'), fresh, 'the update itself is still written');
  });
});

describe('cmdsync --staged', () => {
  /** git, isolated from the user's global and system config (and so their hooks) */
  const gitEnv = (dir: string) => ({ GIT_CONFIG_GLOBAL: join(dir, '.gitconfig-test'), GIT_CONFIG_NOSYSTEM: '1' });
  const git = (dir: string, ...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, ...gitEnv(dir) } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const repo = (files: Record<string, string>) => {
    const dir = project(files);
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'init');
    return dir;
  };

  it('writes and stages stale tracked files, and leaves untracked ones alone', () => {
    const dir = repo({ 'a.md': stale });
    writeFileSync(join(dir, 'new.md'), stale);
    const { status, stdout } = cmdsync(dir, ['--staged'], '', gitEnv(dir));
    assert.equal(status, 0, stdout);
    assert.match(stdout, /new\.md is not tracked by git, leaving it alone/);
    assert.match(stdout, /1 file\(s\) staged/);
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), 'a.md\n');
    assert.equal(read(dir, 'a.md'), fresh);
    assert.equal(read(dir, 'new.md'), stale);
  });

  it('refuses a stale file with unstaged changes, without writing it', () => {
    const dir = repo({ 'a.md': stale });
    writeFileSync(join(dir, 'a.md'), `${stale}edited\n`);
    const { status, stderr } = cmdsync(dir, ['--staged'], '', gitEnv(dir));
    assert.equal(status, 1);
    assert.match(stderr, /a\.md is out of date but has unstaged changes/);
    assert.equal(read(dir, 'a.md'), `${stale}edited\n`);
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '');
  });

  it('cmdsync hook install creates the hook once', () => {
    const dir = repo({ 'a.md': fresh });
    const first = cmdsync(dir, ['hook', 'install'], '', gitEnv(dir));
    assert.match(first.stdout, /^created .*pre-commit\n {2}cmdsync --staged$/m);
    assert.match(cmdsync(dir, ['hook', 'install'], '', gitEnv(dir)).stdout, /cmdsync is already in .*pre-commit/);
  });
});

describe('cmdsync lint', () => {
  it('lists every directive with its lines and mode, and exits 1 on errors and stray markers', () => {
    const dir = project({
      'cmdsync.json': JSON.stringify({ commands: ['echo'] }),
      'a.md': '<!-- CMDSYNC start: echo a -->\nx\n<!-- CMDSYNC end -->\n<!-- CMDSYNC codeblock: cat b -->\n```\n```\n<!-- CMDSYNC end -->\n',
    });
    const { status, stdout, stderr } = cmdsync(dir, ['lint']);
    assert.equal(status, 1);
    assert.match(stdout, /^ {4}ok {7}a\.md:1-3 {2}region {5}echo a$/m);
    assert.match(stderr, /^ {4}failed {3}a\.md:4 {2}codeblock {2}cat b\n {12}unrecognized command\(s\): cat \(allowed: echo\)$/m);
    assert.match(stderr, /^ {4}stray {4}a\.md:7 {2}<!-- CMDSYNC end -->$/m);
    assert.match(stdout, /1 file\(s\), 2 directive\(s\), 2 error\(s\), 0 warning\(s\)/);
  });

  it('warns about binaries that are missing from PATH, and passes', () => {
    const dir = project({ 'a.md': '<!-- CMDSYNC start: surely-not-a-real-binary-x --help -->\n<!-- CMDSYNC end -->\n' });
    const { status, stderr } = cmdsync(dir, ['lint']);
    assert.equal(status, 0);
    assert.match(stderr, /warning a\.md:1 {2}surely-not-a-real-binary-x: not on PATH, and no "install" command for it/);
  });
});

describe('cmdsync init / repos / --all / --group / --repo', () => {
  it('init writes cmdsync.json once, or a package.json key', () => {
    const dir = temp();
    assert.match(cmdsync(dir, ['init']).stdout, /^created .*cmdsync\.json/);
    assert.match(cmdsync(dir, ['init']).stdout, /^already configured: /);
    const pkg = temp();
    writeFileSync(join(pkg, 'package.json'), '{"name":"x"}');
    cmdsync(pkg, ['init', '--package-json']);
    assert.ok(JSON.parse(read(pkg, 'package.json')).cmdsync);
    const legacy = temp();
    writeFileSync(join(legacy, 'update-codeblocks.json'), '{}');
    assert.equal(cmdsync(legacy, ['init']).status, 1);
  });

  it('manages the global config, and runs each selected repository with its own config and the global defaults', () => {
    const home = temp();
    const global = { CMDSYNC_GLOBAL_CONFIG: join(home, 'global.json') };
    const a = project({ 'a.md': '<!-- CMDSYNC start: echo $WHO a -->\nold\n<!-- CMDSYNC end -->\n' });
    const b = project({ 'b.md': '<!-- CMDSYNC start: echo $WHO b -->\nold\n<!-- CMDSYNC end -->\n' });
    assert.match(cmdsync(a, ['--all'], '', global).stderr, /need a global config/);
    assert.match(cmdsync(a, ['init', 'global', '--add', '--group', 'docs'], '', global).stdout, /^created /);
    cmdsync(home, ['repos', 'add', b, '--name', 'bee'], '', global);
    assert.match(cmdsync(home, ['repos'], '', global).stdout, /^bee {2}.*$/m);
    writeFileSync(global.CMDSYNC_GLOBAL_CONFIG, JSON.stringify({ ...JSON.parse(read(home, 'global.json')), defaults: { env: { WHO: 'hi' } } }));

    const grouped = cmdsync(home, ['--group', 'docs', '-q'], '', global);
    assert.equal(grouped.status, 0, grouped.stderr);
    assert.match(read(a, 'a.md'), /^hi a$/m);
    assert.match(read(b, 'b.md'), /^old$/m, 'not in the group');
    const all = cmdsync(home, ['check', '--all'], '', global);
    assert.equal(all.status, 1, 'b is out of date');
    assert.match(all.stdout, /━━ bee /);
    assert.match(all.stdout, /2 repo\(s\), 1 with errors or out of date/);
    cmdsync(home, ['--repo', 'bee', '-q'], '', global);
    assert.match(read(b, 'b.md'), /^hi b$/m);
    assert.equal(cmdsync(home, ['--repo', 'nope'], '', global).status, 2);
    assert.equal(cmdsync(home, ['--all', 'a.md'], '', global).status, 2, 'no paths with --all');
    assert.match(cmdsync(home, ['repos', 'remove', 'bee'], '', global).stdout, /^removed bee/);
  });
});

describe('cmdsync migrate', () => {
  it('--diff shows the changes and exits 1, a run writes them, and a second run has nothing to do', () => {
    const dir = temp();
    writeFileSync(join(dir, 'update-codeblocks.json'), '{"commands":["echo"]}');
    writeFileSync(join(dir, 'README.md'), '<!-- UPDATE_CODEBLOCK: echo hi -->\n```\nold\n```\n');
    const diff = cmdsync(dir, ['migrate', '--diff']);
    assert.equal(diff.status, 1);
    assert.match(diff.stdout, /^-<!-- UPDATE_CODEBLOCK: echo hi -->\n\+<!-- CMDSYNC codeblock: echo hi -->$/m);
    assert.equal(read(dir, 'README.md'), '<!-- UPDATE_CODEBLOCK: echo hi -->\n```\nold\n```\n');
    assert.equal(cmdsync(dir, ['migrate', '-q']).status, 0);
    assert.deepEqual(JSON.parse(read(dir, 'cmdsync.json')).commands, ['echo']);
    assert.throws(() => read(dir, 'update-codeblocks.json'));
    assert.match(cmdsync(dir, ['migrate']).stdout, /nothing to migrate/);
    assert.match(cmdsync(dir, ['migrate', '--from', 'X', '-n']).stdout, /nothing to migrate/);
  });
});

describe('cmdsync in GitHub Actions', () => {
  it('annotates failures and out of date regions, and writes the outputs and step summary', () => {
    const dir = project({ 'a.md': `${stale}<!-- CMDSYNC start: exit 1 -->\n<!-- CMDSYNC end -->\n` });
    const env = { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: join(dir, 'out.txt'), GITHUB_STEP_SUMMARY: join(dir, 'summary.md') };
    const { status, stdout } = cmdsync(dir, ['--check'], '', env);
    assert.equal(status, 1);
    assert.match(stdout, /^::error file=a\.md,line=1,title=cmdsync::Region is out of date/m);
    assert.match(stdout, /^::error file=a\.md,line=4,title=cmdsync::`exit 1` exited with status 1$/m);
    assert.equal(read(dir, 'out.txt'), 'changed=true\nfailed=1\n');
    assert.match(read(dir, 'summary.md'), /^### cmdsync\n\n.*\n\n- `a\.md`$/m);
  });
});

describe('cmdsync completions', () => {
  it('prints a script per shell, and rejects others', () => {
    assert.match(cmdsync(temp(), ['completions', 'fish']).stdout, /^complete -c cmdsync /m);
    assert.match(cmdsync(temp(), ['completions', 'bash']).stdout, /complete -o filenames -o bashdefault -F _cmdsync cmdsync/);
    assert.equal(cmdsync(temp(), ['completions', 'sh']).status, 2);
  });
});
