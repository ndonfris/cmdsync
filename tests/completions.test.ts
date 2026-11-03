import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completionScript } from '../src/completions.js';
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
