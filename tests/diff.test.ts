import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changesOf, diffLines, unifiedDiff } from '../src/diff.ts';

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

describe('changesOf', () => {
  it('splits a diff into runs of changed lines, and applies any subset of them', () => {
    const before = 'a\nb\nc\nd\ne\n';
    const after = 'A\nb\nc\nD\nE\nf\n';
    const { changes, apply } = changesOf(before, after, { context: 1 });
    assert.deepEqual(changes.map(c => c.line), [1, 4]);
    assert.equal(changes[1]?.hunk, '@@ -3,3 +3,4 @@\n c\n-d\n-e\n+D\n+E\n+f');
    assert.equal(apply([true, false]), 'A\nb\nc\nd\ne\n');
    assert.equal(apply([false, true]), 'a\nb\nc\nD\nE\nf\n');
  });

  it('applying none gives the old text and all gives the new one, newline at the end or not', () => {
    const pick = () => Array.from({ length: Math.floor(Math.random() * 12) }, () => 'abc'[Math.floor(Math.random() * 3)]!);
    for (let n = 0; n < 300; n++) {
      const eol = () => Math.random() < 0.5 ? '\n' : '';
      const a = pick();
      const b = pick();
      const before = a.length ? a.join('\n') + eol() : '';
      const after = b.length ? b.join('\n') + eol() : '';
      const { changes, apply } = changesOf(before, after);
      assert.equal(apply(changes.map(() => false)), before, JSON.stringify({ before, after }));
      assert.equal(apply(changes.map(() => true)), after, JSON.stringify({ before, after }));
    }
  });
});
