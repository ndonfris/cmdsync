import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { run } from '../src/index.js';
import { commandBinaries, unrecognizedBinaries } from '../src/run.js';

describe('commandBinaries', () => {
  it('collects the first word of every command segment', () => {
    assert.deepEqual(commandBinaries('FOO=1 my-cli env --json | jq . && echo $(date); /usr/bin/fish -c x'),
      ['my-cli', 'jq', 'echo', 'date', 'fish']);
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
      'docs/page.mdx': '{/* CMDSYNC: echo mdx */}\nold\n{/* /CMDSYNC */}\n',
      'scripts/a.sh': '# CMDSYNC: echo sh\nold\n# /CMDSYNC\n',
      'app.conf': '; GEN: echo conf\nold\n; END\n',
    }, { include: ['**/*.md', '**/*.mdx', '**/*.sh', '*.conf'], syntax: [{ include: ['*.conf'], comment: [';'], marker: 'GEN', endMarker: 'END' }] });
    const results = run(resolveConfig({ cwd: dir }));
    assert.equal(results.length, 4);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf-8'), '<!-- CMDSYNC: echo md -->\n```\nmd\n```\n');
    assert.equal(readFileSync(join(dir, 'docs/page.mdx'), 'utf-8'), '{/* CMDSYNC: echo mdx */}\nmdx\n{/* /CMDSYNC */}\n');
    assert.equal(readFileSync(join(dir, 'scripts/a.sh'), 'utf-8'), '# CMDSYNC: echo sh\nsh\n# /CMDSYNC\n');
    assert.equal(readFileSync(join(dir, 'app.conf'), 'utf-8'), '; GEN: echo conf\nconf\n; END\n');
  });

  it('uses --comment for every file and errors on unknown file types', () => {
    const dir = project({ 'notes.txt': '// CMDSYNC: echo hi\nold\n// /CMDSYNC\n' }, { include: ['*.txt'] });
    assert.throws(() => run(resolveConfig({ cwd: dir })), /No comment syntax known for notes\.txt/);
    run(resolveConfig({ cwd: dir, overrides: { comment: ['//'] } }));
    assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf-8'), '// CMDSYNC: echo hi\nhi\n// /CMDSYNC\n');
  });
});
