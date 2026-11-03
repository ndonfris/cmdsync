import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffLines, unifiedDiff } from '../src/diff.js';

describe('diffLines', () => {
  it('finds a shortest edit script', () => {
    const edits = diffLines(['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c']);
    assert.equal(edits.filter(e => e.op !== ' ').length, 5);
    assert.deepEqual(edits.filter(e => e.op !== '+').map(e => e.line), ['a', 'b', 'c', 'a', 'b', 'b', 'a']);
    assert.deepEqual(edits.filter(e => e.op !== '-').map(e => e.line), ['c', 'b', 'a', 'b', 'a', 'c']);
  });
});

describe('unifiedDiff', () => {
  it('is empty for equal texts', () => {
    assert.equal(unifiedDiff('a\n', 'a\n'), '');
  });

  it('prints hunks with 3 lines of context, like diff -u', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n';
    const after = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\nL\nm\n';
    assert.equal(unifiedDiff(before, after, { path: 'x.md' }), [
      '--- a/x.md', '+++ b/x.md',
      '@@ -1,5 +1,5 @@', ' a', '-b', '+B', ' c', ' d', ' e',
      '@@ -9,4 +9,5 @@', ' i', ' j', ' k', '-l', '+L', '+m', '',
    ].join('\n'));
  });

  it('marks a missing newline at the end of the file', () => {
    assert.equal(unifiedDiff('a\nb', 'a\nb\n'), [
      '--- a/file', '+++ b/file', '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', '',
    ].join('\n'));
  });
});
