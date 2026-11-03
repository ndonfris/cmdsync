import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { manPage } from '../scripts/man.ts';
import { OPTIONS, SUBCOMMANDS } from '../src/options.ts';

describe('man page', () => {
  it('man/cmdsync.1 is up to date with the CLI', () => {
    const committed = readFileSync(join(import.meta.dirname, '..', 'man', 'cmdsync.1'), 'utf-8');
    assert.equal(committed, manPage(), 'man/cmdsync.1 is out of date: run `yarn build:man`');
  });

  it('documents every option and subcommand', () => {
    const page = manPage();
    for (const o of OPTIONS) assert.ok(page.includes(`\\fB\\-\\-${o.long.replace(/-/g, '\\-')}\\fR`), `--${o.long}`);
    for (const s of SUBCOMMANDS) assert.ok(page.includes(`\\fB${s.name}\\fR`), s.name);
  });
});
