import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDirectives, updateRegions } from '../src/regions.js';
import type { RegionSyntax } from '../src/syntax.js';

const ok = (output: string) => () => ({ output, status: 0 });
const echo = (command: string) => ({ output: command, status: 0 });
const md = (...lines: string[]) => lines.join('\n');

const markdown: RegionSyntax = { open: '<!--', close: '-->', fences: true, marker: 'M', endMarker: '/M' };
const html: RegionSyntax = { ...markdown, fences: false };
const mdx: RegionSyntax = { ...markdown, open: '{/*', close: '*/}' };
const hash: RegionSyntax = { open: '#', close: '', fences: false, marker: 'M', endMarker: '/M' };

describe('findDirectives', () => {
  it('finds directives for the configured marker only', () => {
    const content = md('<!-- M: echo a -->', '<!-- OTHER: echo b -->', '<!--M[format=md-table]:  echo c   -->');
    assert.deepEqual(findDirectives(content, markdown), [
      { line: 0, command: 'echo a', options: {} },
      { line: 2, command: 'echo c', options: { format: 'md-table' } },
    ]);
  });

  it('ignores examples in fenced and inline code in markdown', () => {
    const content = md('`<!-- M: a -->`', '````md', '<!-- M: b -->', '````', '<!-- M: c -->');
    assert.deepEqual(findDirectives(content, markdown).map(d => d.command), ['c']);
    assert.deepEqual(findDirectives(content, html).map(d => d.command), ['a', 'b', 'c']);
  });
});

describe('updateRegions: codeblock', () => {
  it('replaces only the code block body, keeping the fences', () => {
    const input = md('# t', '<!-- M: echo hi -->', '```fish', 'old', 'lines', '```', 'after');
    const { content, results } = updateRegions(input, markdown, ok('hi\n'));
    assert.equal(content, md('# t', '<!-- M: echo hi -->', '```fish', 'hi', '```', 'after'));
    assert.equal(results[0]?.kind, 'updated');
  });

  it('allows blank lines between the directive and the fence', () => {
    const input = md('<!-- M: x -->', '', '~~~', 'old', '~~~');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M: x -->', '', '~~~', 'new', '~~~'));
  });

  it('respects longer fences containing nested fences', () => {
    const input = md('<!-- M: x -->', '````md', '```', 'nested', '```', '````', 'tail');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M: x -->', '````md', 'new', '````', 'tail'));
  });

  it('indents output to match an indented fence', () => {
    const input = md('- item', '  <!-- M: x -->', '  ```', '  old', '  ```');
    assert.equal(updateRegions(input, markdown, ok('a\n\nb')).content, md('- item', '  <!-- M: x -->', '  ```', '  a', '', '  b', '  ```'));
  });

  it('does not run directives shown inside the replaced code block', () => {
    const input = md('<!-- M: x -->', '```', '<!-- M: y -->', '```');
    const { results } = updateRegions(input, markdown, echo);
    assert.deepEqual(results.map(r => r.directive.command), ['x']);
  });

  it('keeps the old content when the command fails', () => {
    const input = md('<!-- M: x -->', '```', 'old', '```');
    const { content, results } = updateRegions(input, markdown, () => ({ output: 'boom', status: 2 }));
    assert.equal(content, input);
    assert.equal(results[0]?.kind, 'failed');
  });

  it('is idempotent and reports unchanged blocks', () => {
    const input = md('<!-- M: x -->', '```', 'same', '```');
    const { content, results } = updateRegions(input, markdown, ok('same'));
    assert.equal(content, input);
    assert.deepEqual(results[0], { directive: { line: 0, command: 'x', options: {} }, kind: 'updated', changed: false });
  });
});

describe('updateRegions: block', () => {
  it('replaces everything between the start and end markers', () => {
    const input = md('<!-- M: x -->', '| a |', '| - |', '<!-- /M -->', 'tail');
    assert.equal(updateRegions(input, markdown, ok('| b |\n| - |\n')).content, md('<!-- M: x -->', '| b |', '| - |', '<!-- /M -->', 'tail'));
  });

  it('fills an empty region and can empty it again', () => {
    const empty = md('<!-- M: x -->', '<!-- /M -->');
    assert.equal(updateRegions(empty, markdown, ok('new')).content, md('<!-- M: x -->', 'new', '<!-- /M -->'));
    assert.equal(updateRegions(md('<!-- M: x -->', 'old', '<!-- /M -->'), markdown, ok('')).content, empty);
  });

  it('works with line comments and indents to the start marker', () => {
    const input = md('jobs:', '  # M: x', '  old: 1', '  # /M', 'end: true');
    assert.equal(updateRegions(input, hash, ok('a: 1\nb: 2')).content, md('jobs:', '  # M: x', '  a: 1', '  b: 2', '  # /M', 'end: true'));
  });

  it('works with mdx comments', () => {
    const input = md('{/* M: x */}', 'old', '{/* /M */}');
    assert.equal(updateRegions(input, mdx, ok('new')).content, md('{/* M: x */}', 'new', '{/* /M */}'));
  });

  it('skips end markers inside fenced code in markdown', () => {
    const input = md('<!-- M: x -->', 'intro', '```', '<!-- /M -->', '```', 'old', '<!-- /M -->');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M: x -->', 'new', '<!-- /M -->'));
  });

  it('reports a missing end marker, and stops at the next directive', () => {
    const input = md('<!-- M: x -->', 'text', '<!-- M: y -->', 'old', '<!-- /M -->');
    const { content, results } = updateRegions(input, html, echo);
    assert.equal(content, md('<!-- M: x -->', 'text', '<!-- M: y -->', 'y', '<!-- /M -->'));
    assert.deepEqual(results.map(r => r.kind), ['invalid', 'updated']);
  });

  it('supports custom start and end text', () => {
    const syntax: RegionSyntax = { ...hash, open: ';', marker: 'BEGIN_GEN', endMarker: 'END_GEN' };
    const input = md('; BEGIN_GEN: x', 'old', '; END_GEN');
    assert.equal(updateRegions(input, syntax, ok('new')).content, md('; BEGIN_GEN: x', 'new', '; END_GEN'));
  });
});

describe('updateRegions: inline', () => {
  it('replaces text between markers on the same line', () => {
    const input = '<p>v<!-- M: a -->1.0.0<!-- /M --> and <!-- M: b --><!-- /M --></p>';
    const { content, results } = updateRegions(input, html, c => ok(`${c}-out\n`)());
    assert.equal(content, '<p>v<!-- M: a -->a-out<!-- /M --> and <!-- M: b -->b-out<!-- /M --></p>');
    assert.deepEqual(results.map(r => r.kind === 'updated' && r.changed), [true, true]);
  });

  it('keeps the old text when the command fails', () => {
    const input = '<span><!-- M: x -->old<!-- /M --></span>';
    assert.equal(updateRegions(input, html, () => ({ output: '', status: 1 })).content, input);
  });
});

describe('updateRegions: formats', () => {
  it('formats JSON output as a markdown table', () => {
    const input = md('<!-- M[format=md-table]: x -->', '<!-- /M -->');
    const json = JSON.stringify([{ code: 1001, text: 'a|b' }]);
    assert.equal(updateRegions(input, markdown, ok(json)).content,
      md('<!-- M[format=md-table]: x -->', '| code | text |', '| ---- | ---- |', '| 1001 | a\\|b |', '<!-- /M -->'));
  });

  it('reports bad options and non-JSON output', () => {
    const input = md('<!-- M[format=csv]: x -->', '<!-- /M -->', '<!-- M[format=md-table]: y -->', '<!-- /M -->');
    const { content, results } = updateRegions(input, markdown, ok('not json'));
    assert.equal(content, input);
    assert.deepEqual(results.map(r => r.kind), ['invalid', 'failed']);
  });
});
