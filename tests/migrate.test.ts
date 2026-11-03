import './setup.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { migrateDirectives, planMigration } from '../src/migrate.ts';

const md = (...lines: string[]) => lines.join('\n');
const html = { open: '<!--', close: '-->', fences: true };
const hash = { open: '#', close: '', fences: false };
const migration = { from: ['UPDATE_CODEBLOCK', 'CMDSYNC'], marker: 'CMDSYNC', endMarker: 'CMDSYNC end' };

describe('migrateDirectives', () => {
  it('turns update-codeblocks directives into codeblock directives', () => {
    const input = md('<!-- UPDATE_CODEBLOCK: a --help -->', '', '```text', 'old', '```');
    const { content, converted } = migrateDirectives(input, html, migration);
    assert.equal(content, md('<!-- CMDSYNC codeblock: a --help -->', '', '```text', 'old', '```'));
    assert.equal(converted, 1);
  });

  it('converts old cmdsync regions, inline regions and options, in any comment syntax', () => {
    const input = md(
      '<!-- CMDSYNC[format=md-table, x = y]: a -->', '| t |', '<!-- /CMDSYNC -->',
      'v <!-- CMDSYNC: b -->1<!-- /CMDSYNC --> <!--CMDSYNC: c--><!--/CMDSYNC-->',
    );
    assert.equal(migrateDirectives(input, html, migration).content, md(
      '<!-- CMDSYNC start format=md-table x=y: a -->', '| t |', '<!-- CMDSYNC end -->',
      'v <!-- CMDSYNC start: b -->1<!-- CMDSYNC end --> <!-- CMDSYNC start: c--><!-- CMDSYNC end-->',
    ));
    assert.equal(migrateDirectives(md('# CMDSYNC: d', 'x', '# /CMDSYNC'), hash, migration).content, md('# CMDSYNC start: d', 'x', '# CMDSYNC end'));
  });

  it('does not take an end marker inside an ignored range for an old directive\'s', () => {
    const input = md('<!-- CMDSYNC: a -->', 'x', '<!-- CMDSYNC ignore start -->', '<!-- /CMDSYNC -->', '<!-- CMDSYNC ignore end -->');
    const result = migrateDirectives(input, html, migration);
    assert.equal(result.content, input);
    assert.deepEqual(result.unclassified, [0]);
  });

  it('leaves ignored ranges alone', () => {
    const input = md('<!-- CMDSYNC ignore start -->', '<!-- CMDSYNC[format=md-table]: a -->', 'x', '<!-- /CMDSYNC -->', '<!-- CMDSYNC ignore end -->');
    assert.equal(migrateDirectives(input, html, migration).content, input);
  });

  it('leaves current syntax, examples in code, and directives it cannot classify alone', () => {
    const input = md(
      '<!-- CMDSYNC start: a -->', '<!-- CMDSYNC end -->',
      '`<!-- CMDSYNC: example -->`',
      '````md', '<!-- CMDSYNC: in a fence -->', '````',
      '<!-- CMDSYNC: dangling -->', 'text',
    );
    const result = migrateDirectives(input, html, migration);
    assert.equal(result.content, input);
    assert.deepEqual(result.unclassified, [6]);
  });
});

describe('planMigration', () => {
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return dir;
  };

  it('replaces update-codeblocks.json, keeping its settings and converting its custom marker', () => {
    const dir = project({
      'update-codeblocks.json': JSON.stringify({ $schema: 'old', marker: 'DOCS', commands: ['my-cli'] }),
      'README.md': '<!-- DOCS: my-cli -->\n```\nx\n```\n',
    });
    const plan = planMigration(dir);
    const by = (name: string) => plan.files.find(f => f.file === join(dir, name));
    assert.equal(by('update-codeblocks.json')?.after, null);
    assert.deepEqual(JSON.parse(by('cmdsync.json')!.after!), { $schema: 'https://unpkg.com/cmdsync/cmdsync.schema.json', commands: ['my-cli'] });
    assert.equal(by('README.md')?.after, '<!-- CMDSYNC codeblock: my-cli -->\n```\nx\n```\n');
  });

  it('edits package.json in place: the config key and the scripts, and notes the dependency', () => {
    const pkg = '{\n  "scripts": { "docs": "update-codeblocks --check" },\n  "devDependencies": { "update-codeblocks": "1" },\n  "update-codeblocks": { "include": ["*.md"] }\n}\n';
    const plan = planMigration(project({ 'package.json': pkg }));
    assert.equal(plan.files[0]?.after, pkg.replace('"docs": "update-codeblocks', '"docs": "cmdsync').replace('"update-codeblocks": {', '"cmdsync": {'));
    assert.match(plan.notes[0]!, /yarn remove update-codeblocks && yarn add -D cmdsync/);
  });

  it('converts the markers given with `from`, and rejects invalid ones', () => {
    const dir = project({
      'cmdsync.json': '{}',
      'README.md': '<!-- DOCS: a -->\n```sh\nx\n```\n<!-- EMBED[format=md-table]: b -->\n| x |\n<!-- /EMBED -->\n<!-- OTHER: c -->\n```\n```\n',
    });
    const [readme] = planMigration(dir, { from: ['DOCS', 'EMBED'] }).files;
    assert.equal(readme?.after, '<!-- CMDSYNC codeblock: a -->\n```sh\nx\n```\n<!-- CMDSYNC start format=md-table: b -->\n| x |\n<!-- CMDSYNC end -->\n<!-- OTHER: c -->\n```\n```\n');
    assert.throws(() => planMigration(dir, { from: ['a b'] }), /invalid marker "a b"/);
  });

  it('updates workflows, and has nothing to do the second time', () => {
    const dir = project({
      '.github/workflows/docs.yml': 'steps:\n  - uses: ndonfris/fish-lsp/packages/update-codeblocks@v1\n  - run: npx update-codeblocks --check\n',
      'cmdsync.json': '{}',
    });
    const [workflow] = planMigration(dir).files;
    assert.equal(workflow?.after, 'steps:\n  - uses: ndonfris/cmdsync@master\n  - run: npx cmdsync --check\n');
    writeFileSync(workflow!.file, workflow!.after!);
    assert.deepEqual(planMigration(dir), { files: [], notes: [] });
  });
});
