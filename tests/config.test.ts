import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

const fixture = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
  Object.entries(files).forEach(([name, json]) => {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(json));
  });
  return dir;
};

describe('resolveConfig', () => {
  it('reads the "cmdsync" key of package.json', () => {
    const dir = fixture({ 'package.json': { name: 'x', cmdsync: { shell: 'fish', commands: ['fish-lsp'] } } });
    const config = resolveConfig({ cwd: join(dir) });
    assert.equal(config.shell, 'fish');
    assert.deepEqual(config.commands, ['fish-lsp']);
    assert.equal(config.marker, DEFAULT_CONFIG.marker);
    assert.equal(config.source, `${join(dir, 'package.json')}#cmdsync`);
  });

  it('prefers cmdsync.json and walks up from nested directories', () => {
    const dir = fixture({
      'package.json': { cmdsync: { shell: 'fish' } },
      'cmdsync.json': { $schema: './schema.json', shell: 'bash', cwd: 'sub' },
      'sub/deep/.keep': {},
    });
    const config = resolveConfig({ cwd: join(dir, 'sub', 'deep') });
    assert.equal(config.shell, 'bash');
    assert.equal(config.root, dir);
    assert.equal(config.cwd, join(dir, 'sub'));
  });

  it('applies overrides on top of the file config', () => {
    const dir = fixture({ 'cmdsync.json': { marker: 'A' } });
    assert.equal(resolveConfig({ cwd: dir, overrides: { marker: 'B' } }).marker, 'B');
  });

  it('derives the end marker from the marker unless set', () => {
    assert.equal(resolveConfig({ cwd: fixture({ 'cmdsync.json': { marker: 'A' } }) }).endMarker, 'A end');
    assert.equal(resolveConfig({ cwd: fixture({ 'cmdsync.json': { endMarker: 'END' } }) }).endMarker, 'END');
    assert.equal(resolveConfig({ cwd: fixture({ 'cmdsync.json': {} }) }).endMarker, 'CMDSYNC end');
  });

  it('validates syntax rules', () => {
    const rule = { include: ['*.conf'], comment: [';'] };
    assert.deepEqual(resolveConfig({ cwd: fixture({ 'cmdsync.json': { syntax: [rule] } }) }).syntax, [rule]);
    assert.throws(() => resolveConfig({ cwd: fixture({ 'cmdsync.json': { syntax: [{ ...rule, comment: [] }] } }) }), /invalid value for "syntax"/);
    assert.throws(() => resolveConfig({ cwd: fixture({ 'cmdsync.json': { syntax: [{ ...rule, extra: 1 }] } }) }), /invalid value for "syntax"/);
  });

  it('rejects unknown keys and bad values', () => {
    assert.throws(() => resolveConfig({ cwd: fixture({ 'cmdsync.json': { shel: 'x' } }) }), /unknown config key "shel"/);
    assert.throws(() => resolveConfig({ cwd: fixture({ 'cmdsync.json': { commands: 'x' } }) }), /invalid value for "commands"/);
  });

  it('falls back to defaults without a config', () => {
    const dir = fixture({ 'package.json': { name: 'no-config' } });
    const config = resolveConfig({ cwd: dir });
    assert.equal(config.source, null);
    // the default shell is `auto`, resolved to a real shell (see tests/shell.test.ts for how)
    assert.ok(config.shell && config.shell !== 'auto');
    assert.ok(config.shellFrom);
  });
});
