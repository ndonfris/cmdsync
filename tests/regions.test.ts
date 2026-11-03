import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDirectives, includeLines, updateRegions } from '../src/regions.js';
import type { RegionSyntax } from '../src/syntax.js';

const ok = (output: string) => () => ({ output, status: 0 });
const echo = (command: string) => ({ output: command, status: 0 });
const md = (...lines: string[]) => lines.join('\n');

const markdown: RegionSyntax = { open: '<!--', close: '-->', fences: true, marker: 'M', endMarker: 'M end' };
const html: RegionSyntax = { ...markdown, fences: false };
const mdx: RegionSyntax = { ...markdown, open: '{/*', close: '*/}' };
const hash: RegionSyntax = { open: '#', close: '', fences: false, marker: 'M', endMarker: 'M end' };

describe('findDirectives', () => {
  it('finds directives for the configured marker only', () => {
    const content = md('<!-- M: echo a -->', '<!-- OTHER: echo b -->', '<!--M region  format=md-table:  echo c   -->', '<!-- MX: echo d -->');
    assert.deepEqual(findDirectives(content, markdown), [
      { line: 0, command: 'echo a', options: {} },
      { line: 2, command: 'echo c', options: { mode: 'region', format: 'md-table' } },
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
    assert.deepEqual(results[0], { directive: { line: 0, command: 'x', options: {} }, kind: 'updated', changed: false, as: 'codeblock', end: 3 });
  });
});

describe('updateRegions: block', () => {
  it('replaces everything between the start and end markers', () => {
    const input = md('<!-- M: x -->', '| a |', '| - |', '<!-- M end -->', 'tail');
    assert.equal(updateRegions(input, markdown, ok('| b |\n| - |\n')).content, md('<!-- M: x -->', '| b |', '| - |', '<!-- M end -->', 'tail'));
  });

  it('fills an empty region and can empty it again', () => {
    const empty = md('<!-- M: x -->', '<!-- M end -->');
    assert.equal(updateRegions(empty, markdown, ok('new')).content, md('<!-- M: x -->', 'new', '<!-- M end -->'));
    assert.equal(updateRegions(md('<!-- M: x -->', 'old', '<!-- M end -->'), markdown, ok('')).content, empty);
  });

  it('works with line comments and indents to the start marker', () => {
    const input = md('jobs:', '  # M: x', '  old: 1', '  # M end', 'end: true');
    assert.equal(updateRegions(input, hash, ok('a: 1\nb: 2')).content, md('jobs:', '  # M: x', '  a: 1', '  b: 2', '  # M end', 'end: true'));
  });

  it('works with mdx comments', () => {
    const input = md('{/* M: x */}', 'old', '{/* M end */}');
    assert.equal(updateRegions(input, mdx, ok('new')).content, md('{/* M: x */}', 'new', '{/* M end */}'));
  });

  it('skips end markers inside fenced code in markdown', () => {
    const input = md('<!-- M: x -->', 'intro', '```', '<!-- M end -->', '```', 'old', '<!-- M end -->');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M: x -->', 'new', '<!-- M end -->'));
  });

  it('reports a missing end marker, and stops at the next directive', () => {
    const input = md('<!-- M: x -->', 'text', '<!-- M: y -->', 'old', '<!-- M end -->');
    const { content, results } = updateRegions(input, html, echo);
    assert.equal(content, md('<!-- M: x -->', 'text', '<!-- M: y -->', 'y', '<!-- M end -->'));
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
    const input = '<p>v<!-- M: a -->1.0.0<!-- M end --> and <!-- M: b --><!-- M end --></p>';
    const { content, results } = updateRegions(input, html, c => ok(`${c}-out\n`)());
    assert.equal(content, '<p>v<!-- M: a -->a-out<!-- M end --> and <!-- M: b -->b-out<!-- M end --></p>');
    assert.deepEqual(results.map(r => r.kind === 'updated' && r.changed), [true, true]);
  });

  it('keeps the old text when the command fails', () => {
    const input = '<span><!-- M: x -->old<!-- M end --></span>';
    assert.equal(updateRegions(input, html, () => ({ output: '', status: 1 })).content, input);
  });
});

describe('updateRegions: formats', () => {
  it('formats JSON output as a markdown table', () => {
    const input = md('<!-- M format=md-table: x -->', '<!-- M end -->');
    const json = JSON.stringify([{ code: 1001, text: 'a|b' }]);
    assert.equal(updateRegions(input, markdown, ok(json)).content,
      md('<!-- M format=md-table: x -->', '| code | text |', '| ---- | ---- |', '| 1001 | a\\|b |', '<!-- M end -->'));
  });

  it('reports bad options and non-JSON output', () => {
    const input = md(
      '<!-- M format=csv: x -->', '<!-- M end -->',
      '<!-- M region format=md-table: y -->', '<!-- M end -->',
      '<!-- M paragraph: z -->', '<!-- M end -->',
    );
    const { content, results } = updateRegions(input, markdown, ok('not json'));
    assert.equal(content, input);
    assert.deepEqual(results.map(r => r.kind), ['invalid', 'failed', 'invalid']);
    assert.match(results[2]?.kind === 'invalid' ? results[2].reason : '', /unknown mode "paragraph"/);
  });
});

describe('updateRegions: explicit modes', () => {
  it('region replaces up to the end marker, even when the content starts with a fence', () => {
    const input = md('<!-- M region: x -->', '```', 'old', '```', 'more', '<!-- M end -->');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M region: x -->', 'new', '<!-- M end -->'));
  });

  it('codeblock requires a fence to follow', () => {
    const input = md('<!-- M codeblock: x -->', 'text', '<!-- M end -->');
    const { content, results } = updateRegions(input, markdown, ok('new'));
    assert.equal(content, input);
    assert.match(results[0]?.kind === 'invalid' ? results[0].reason : '', /expected a fenced code block/);
    assert.equal(updateRegions(md('<!-- M codeblock: x -->', '```', 'old', '```'), markdown, ok('new')).content,
      md('<!-- M codeblock: x -->', '```', 'new', '```'));
  });

  it('codeblock lang= sets the language of the fence, keeping attributes after it', () => {
    const input = md('<!-- M codeblock lang=fish: x -->', '', '```sh title="x"', 'old', '```');
    const { content, results } = updateRegions(input, markdown, ok('new'));
    assert.equal(content, md('<!-- M codeblock lang=fish: x -->', '', '```fish title="x"', 'new', '```'));
    assert.deepEqual(results.map(r => r.kind === 'updated' && r.changed), [true]);
    assert.equal(updateRegions(md('<!-- M codeblock lang=c++: x -->', '~~~', 'new', '~~~'), markdown, ok('new')).content,
      md('<!-- M codeblock lang=c++: x -->', '~~~c++', 'new', '~~~'));
  });

  it('codeblock lang= creates the block when none follows, then keeps it up to date', () => {
    const input = md('  <!-- M codeblock lang=md: x -->', '  text');
    const first = updateRegions(input, markdown, ok('a\n```sh\nb\n```')).content;
    assert.equal(first, md('  <!-- M codeblock lang=md: x -->', '  ````md', '  a', '  ```sh', '  b', '  ```', '  ````', '  text'));
    const second = updateRegions(first, markdown, ok('a\n```sh\nb\n```'));
    assert.equal(second.content, first);
    assert.deepEqual(second.results.map(r => r.kind === 'updated' && r.changed), [false]);
  });

  it('lang= only applies to codeblock directives', () => {
    for (const head of ['start lang=sh', 'line lang=sh', 'lang=sh']) {
      const { results } = updateRegions(md(`<!-- M ${head}: x -->`, '```', '```'), markdown, ok('new'));
      assert.match(results[0]?.kind === 'invalid' ? results[0].reason : '', /`lang` only applies to `codeblock`/);
    }
  });

  it('codeblock is markdown only', () => {
    const { results } = updateRegions(md('# M codeblock: x', '```', '```'), hash, ok('new'));
    assert.match(results[0]?.kind === 'invalid' ? results[0].reason : '', /only works in markdown/);
  });

  it('line replaces exactly the next line, indented like the directive', () => {
    const input = md('version:', '  # M line: x', '  old: 1', 'tail: true');
    const { content, results } = updateRegions(input, hash, ok('new: 2\n'));
    assert.equal(content, md('version:', '  # M line: x', '  new: 2', 'tail: true'));
    assert.deepEqual(results.map(r => r.kind === 'updated' && r.changed), [true]);
    assert.equal(updateRegions(content, hash, ok('new: 2')).content, content);
  });

  it('line ignores an end marker on its own line and works in html', () => {
    const input = md('<!-- M line: x --><!-- M end -->', '<img src="v1.svg">', 'tail');
    assert.equal(updateRegions(input, markdown, ok('<img src="v2.svg">')).content,
      md('<!-- M line: x --><!-- M end -->', '<img src="v2.svg">', 'tail'));
  });

  it('line rejects multi-line output and a missing or structural next line', () => {
    const multi = updateRegions(md('# M line: x', 'old'), hash, ok('a\nb'));
    assert.equal(multi.content, md('# M line: x', 'old'));
    assert.match(multi.results[0]?.kind === 'failed' ? multi.results[0].result.error ?? '' : '', /one line of output, got 2/);
    assert.equal(updateRegions('# M line: x', hash, ok('a')).results[0]?.kind, 'invalid');
    assert.equal(updateRegions(md('# M line: x', '# M end'), hash, ok('a')).results[0]?.kind, 'invalid');
    assert.equal(updateRegions(md('<!-- M line: x -->', '```', '```'), markdown, ok('a')).results[0]?.kind, 'invalid');
  });
});

describe('updateRegions: start/end markers', () => {
  it('treats `start` alone as `region start`', () => {
    const content = md('<!-- M region start format=md-table: a -->', '<!-- M end -->', '<!-- M start: b -->', '<!-- M end -->');
    assert.deepEqual(findDirectives(content, markdown).map(d => d.options), [
      { mode: 'region', start: true, format: 'md-table' },
      { mode: 'region', start: true },
    ]);
    assert.equal(updateRegions(content.replace('format=md-table ', '').replace(' format=md-table', ''), markdown, echo).content,
      md('<!-- M region start: a -->', 'a', '<!-- M end -->', '<!-- M start: b -->', 'b', '<!-- M end -->'));
  });

  it('`start` alone is a region even when a fence follows', () => {
    const input = md('<!-- M start: x -->', '```sh', 'old', '```', '<!-- M end -->');
    assert.equal(updateRegions(input, markdown, ok('new')).content, md('<!-- M start: x -->', 'new', '<!-- M end -->'));
  });

  it('never mistakes an end marker for a start on the same line', () => {
    const input = '<p><!-- M region start: a -->1<!-- M end --> and <!-- M start: b -->2<!-- M end --></p>';
    assert.equal(updateRegions(input, html, echo).content,
      '<p><!-- M region start: a -->a<!-- M end --> and <!-- M start: b -->b<!-- M end --></p>');
  });

  it('matches end markers with any whitespace', () => {
    const input = md('# M start: x', 'old', '#   M   end');
    assert.equal(updateRegions(input, hash, ok('new')).content, md('# M start: x', 'new', '#   M   end'));
  });

  it('rejects `start` on modes without an end marker', () => {
    const { results } = updateRegions(md('# M line start: x', 'old'), hash, ok('new'));
    assert.match(results[0]?.kind === 'invalid' ? results[0].reason : '', /`line` directives have no end marker/);
  });
});

describe('updateRegions: include=', () => {
  const files: Record<string, string> = { 'a.ts': 'function f() {\n  if (x) {\n    return 1;\n  }\n}\n' };
  const read = (path: string) => path in files ? { output: files[path]!, status: 0 } : { output: '', status: 1, error: `include ${path}: no such file` };
  const never = () => assert.fail('include directives never run a command');

  it('replaces a region with a file, or a dedented line range of one, without a command', () => {
    const input = md('<!-- M start include=a.ts#L2-L4 -->', 'old', '<!-- M end -->', 'x <!-- M start include=a.ts#L3 -->old<!-- M end -->');
    const { content, results } = updateRegions(input, markdown, never, { read });
    assert.equal(content, md('<!-- M start include=a.ts#L2-L4 -->', 'if (x) {', '  return 1;', '}', '<!-- M end -->', 'x <!-- M start include=a.ts#L3 -->return 1;<!-- M end -->'));
    assert.deepEqual(results.map(r => r.kind === 'updated' && [r.as, r.end]), [['region', 2], ['inline', 3]]);
  });

  it('works with codeblock lang= and open-ended ranges', () => {
    const input = md('<!-- M codeblock lang=ts include=a.ts#L4- -->');
    assert.equal(updateRegions(input, markdown, never, { read }).content, md(input, '```ts', '  }', '}', '```'));
  });

  it('reports missing files, ranges past the end, and conflicts with a command', () => {
    const input = md(
      '<!-- M start include=nope.ts -->', '<!-- M end -->',
      '<!-- M start include=a.ts#L9 -->', '<!-- M end -->',
      '<!-- M start include=a.ts#L3-L2 -->', '<!-- M end -->',
      '<!-- M start include=a.ts: echo -->', '<!-- M end -->',
    );
    const { results, stray } = updateRegions(input, markdown, never, { read });
    assert.deepEqual(results.map(r => r.kind === 'failed' ? r.result.error : r.kind === 'invalid' ? r.reason : r.kind), [
      'include nope.ts: no such file',
      'a.ts#L9 is past the end of a.ts (5 lines)',
      'invalid line range in include "a.ts#L3-L2"',
      '`include=` replaces the command, so use one or the other',
    ]);
    assert.deepEqual(stray, []);
  });

  it('includeLines keeps a whole file as is', () => {
    assert.equal(includeLines('  a\n', { spec: 'f', path: 'f' }), '  a\n');
  });
});

describe('updateRegions: lint', () => {
  it('validates without changing anything or formatting output', () => {
    const input = md('<!-- M start format=md-table: x -->', 'old', '<!-- M end -->', '<!-- M line: y -->', 'old');
    const { content, results } = updateRegions(input, markdown, ok('not json'), { lint: true });
    assert.equal(content.split('\n')[0], input.split('\n')[0]);
    assert.deepEqual(results.map(r => r.kind === 'updated' && [r.as, r.changed]), [['region', false], ['line', false]]);
  });

  it('finds stray markers: orphan end markers and typos, but not ones in inline code', () => {
    const input = md(
      '<!-- M start: a -->', 'x', '<!-- M end -->',
      '<!-- M end -->',
      '<!-- M strat a -->',
      '`<!-- M end -->` is an example',
      'v<!-- M start: b -->1<!-- M end --> <!-- M end -->',
      '<!-- MORE -->',
    );
    assert.deepEqual(updateRegions(input, markdown, ok(''), { lint: true }).stray, [3, 4, 6]);
  });

  it('an invalid directive keeps its end marker, so it is not reported as stray', () => {
    const { results, stray } = updateRegions(md('<!-- M strat: a -->', 'x', '<!-- M end -->'), markdown, ok(''), { lint: true });
    assert.equal(results[0]?.kind, 'invalid');
    assert.deepEqual(stray, []);
  });
});
