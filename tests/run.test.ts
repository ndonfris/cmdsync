import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
