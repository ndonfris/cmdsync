import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlTable, mdTable, tableRows } from '../src/format.js';
import { builtinSyntax } from '../src/syntax.js';

describe('tableRows', () => {
  it('uses object keys in first-seen order as columns', () => {
    assert.deepEqual(tableRows('[{"a":1},{"b":true,"a":null},{"c":{"d":2}}]'), [
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['', 'true', ''],
      ['', '', '{"d":2}'],
    ]);
  });

  it('takes the first row of an array of arrays as the header', () => {
    assert.deepEqual(tableRows('[["x","y"],[1,2]]'), [['x', 'y'], ['1', '2']]);
  });

  it('rejects anything else', () => {
    assert.throws(() => tableRows('{}'), /JSON array/);
    assert.throws(() => tableRows('[1, 2]'), /array of objects or an array of arrays/);
  });
});

describe('tables', () => {
  it('pads markdown columns and escapes pipes and newlines', () => {
    assert.equal(mdTable([['Code', 'Text'], ['1', 'a|b\nc']]), [
      '| Code | Text |',
      '| ---- | ---- |',
      '| 1    | a\\|b<br />c |',
    ].join('\n'));
  });

  it('escapes html and braces (for mdx)', () => {
    assert.equal(htmlTable([['A'], ['<b>{x}</b> & "y"']]), [
      '<table>',
      '  <thead>',
      '    <tr><th>A</th></tr>',
      '  </thead>',
      '  <tbody>',
      '    <tr><td>&#60;b&#62;&#123;x&#125;&#60;/b&#62; &#38; &#34;y&#34;</td></tr>',
      '  </tbody>',
      '</table>',
    ].join('\n'));
  });

  it('handles a header shorter than its rows', () => {
    assert.equal(mdTable([['a'], ['1', '2']]), '| a   |  |\n| --- | --- |\n| 1   | 2 |');
  });

  it('renders nothing for no rows', () => {
    assert.equal(mdTable([]), '');
    assert.equal(htmlTable(tableRows('[]')), '');
  });
});

describe('builtinSyntax', () => {
  it('detects syntax by extension and basename', () => {
    assert.equal(builtinSyntax('docs/README.md')?.open, '<!--');
    assert.equal(builtinSyntax('docs/README.md')?.fences, true);
    assert.equal(builtinSyntax('page.mdx')?.open, '{/*');
    assert.equal(builtinSyntax('index.html')?.fences, false);
    assert.equal(builtinSyntax('ci.YML')?.open, '#');
    assert.equal(builtinSyntax('src/a.ts')?.open, '//');
    assert.equal(builtinSyntax('Makefile')?.open, '#');
    assert.equal(builtinSyntax('.gitignore')?.open, '#');
    assert.equal(builtinSyntax('style.css')?.close, '*/');
    assert.equal(builtinSyntax('data.json'), undefined);
  });
});
