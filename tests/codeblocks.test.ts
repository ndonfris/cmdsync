import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDirectives, updateCodeblocks } from '../src/codeblocks.js';

const ok = (output: string) => () => ({ output, status: 0 });
const md = (...lines: string[]) => lines.join('\n');

describe('findDirectives', () => {
  it('finds directives for the configured marker only', () => {
    const content = md('<!-- UPDATE_CODEBLOCK: echo a -->', '<!-- OTHER: echo b -->', '<!--MY.MARK:  echo c   -->');
    assert.deepEqual(findDirectives(content, 'UPDATE_CODEBLOCK'), [{ line: 0, command: 'echo a' }]);
    assert.deepEqual(findDirectives(content, 'MY.MARK'), [{ line: 2, command: 'echo c' }]);
  });
});

describe('updateCodeblocks', () => {
  it('replaces only the code block body, keeping the fences', () => {
    const input = md('# t', '<!-- M: echo hi -->', '```fish', 'old', 'lines', '```', 'after');
    const { content, results } = updateCodeblocks(input, 'M', ok('hi\n'));
    assert.equal(content, md('# t', '<!-- M: echo hi -->', '```fish', 'hi', '```', 'after'));
    assert.equal(results[0]?.kind, 'updated');
  });

  it('allows blank lines between the directive and the fence', () => {
    const input = md('<!-- M: x -->', '', '~~~', 'old', '~~~');
    assert.equal(updateCodeblocks(input, 'M', ok('new')).content, md('<!-- M: x -->', '', '~~~', 'new', '~~~'));
  });

  it('respects longer fences containing nested fences', () => {
    const input = md('<!-- M: x -->', '````md', '```', 'nested', '```', '````', 'tail');
    assert.equal(updateCodeblocks(input, 'M', ok('new')).content, md('<!-- M: x -->', '````md', 'new', '````', 'tail'));
  });

  it('keeps the old content when the command fails', () => {
    const input = md('<!-- M: x -->', '```', 'old', '```');
    const { content, results } = updateCodeblocks(input, 'M', () => ({ output: 'boom', status: 2 }));
    assert.equal(content, input);
    assert.equal(results[0]?.kind, 'failed');
  });

  it('reports directives without a code block and leaves the rest intact', () => {
    const input = md('<!-- M: x -->', 'text', '<!-- M: y -->', '```', 'old', '```');
    const { content, results } = updateCodeblocks(input, 'M', c => ({ output: c, status: 0 }));
    assert.equal(content, md('<!-- M: x -->', 'text', '<!-- M: y -->', '```', 'y', '```'));
    assert.deepEqual(results.map(r => r.kind), ['missing-codeblock', 'updated']);
  });

  it('is idempotent and reports unchanged blocks', () => {
    const input = md('<!-- M: x -->', '```', 'same', '```');
    const { content, results } = updateCodeblocks(input, 'M', ok('same'));
    assert.equal(content, input);
    assert.deepEqual(results[0], { directive: { line: 0, command: 'x' }, kind: 'updated', changed: false });
  });
});
