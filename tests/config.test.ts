import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

const fixture = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'update-codeblocks-'));
  Object.entries(files).forEach(([name, json]) => {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(json));
  });
  return dir;
};

describe('resolveConfig', () => {
  it('reads the "update-codeblocks" key of package.json', () => {
    const dir = fixture({ 'package.json': { name: 'x', 'update-codeblocks': { shell: 'fish', commands: ['fish-lsp'] } } });
    const config = resolveConfig({ cwd: join(dir) });
    assert.equal(config.shell, 'fish');
    assert.deepEqual(config.commands, ['fish-lsp']);
    assert.equal(config.marker, DEFAULT_CONFIG.marker);
    assert.equal(config.source, `${join(dir, 'package.json')}#update-codeblocks`);
  });

  it('prefers update-codeblocks.json and walks up from nested directories', () => {
    const dir = fixture({
      'package.json': { 'update-codeblocks': { shell: 'fish' } },
      'update-codeblocks.json': { $schema: './schema.json', shell: 'bash', cwd: 'sub' },
      'sub/deep/.keep': {},
    });
    const config = resolveConfig({ cwd: join(dir, 'sub', 'deep') });
    assert.equal(config.shell, 'bash');
    assert.equal(config.root, dir);
    assert.equal(config.cwd, join(dir, 'sub'));
  });

  it('applies overrides on top of the file config', () => {
    const dir = fixture({ 'update-codeblocks.json': { marker: 'A' } });
    assert.equal(resolveConfig({ cwd: dir, overrides: { marker: 'B' } }).marker, 'B');
  });

  it('rejects unknown keys and bad values', () => {
    assert.throws(() => resolveConfig({ cwd: fixture({ 'update-codeblocks.json': { shel: 'x' } }) }), /unknown config key "shel"/);
    assert.throws(() => resolveConfig({ cwd: fixture({ 'update-codeblocks.json': { commands: 'x' } }) }), /invalid value for "commands"/);
  });

  it('falls back to defaults without a config', () => {
    const dir = fixture({ 'package.json': { name: 'no-config' } });
    const config = resolveConfig({ cwd: dir });
    assert.equal(config.source, null);
    assert.equal(config.shell, 'sh');
  });
});
