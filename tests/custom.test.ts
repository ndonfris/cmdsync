import './setup.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../src/config.ts';
import { customHooks, loadFormatters, renderTemplate } from '../src/custom.ts';
import { run } from '../src/index.ts';
import { updateRegions } from '../src/regions.ts';

const md = (...lines: string[]) => lines.join('\n');

describe('renderTemplate', () => {
  const vars = { output: 'a\nb\n', lang: 'fish', 'params.x': '1' };

  it('fills placeholders and pipes them through filters', () => {
    assert.equal(renderTemplate('{output|quote}', vars), '> a\n> b');
    assert.equal(renderTemplate('{output|code}', vars), '```fish\na\nb\n```');
    assert.equal(renderTemplate('{output|code:txt|indent:4}', vars), '    ```txt\n    a\n    b\n    ```');
    assert.equal(renderTemplate('{output|first|upper} {output|lines} {params.x} {params.y|default:none}', vars), 'A 2 1 none');
    assert.equal(renderTemplate('{{literal}} {output|trim|json}', vars), '{literal} "a\\nb"');
    assert.equal(renderTemplate('{output|quote:// }', vars), '// a\n// b');
  });

  it('rejects unknown placeholders and filters, and unset params without a default', () => {
    assert.throws(() => renderTemplate('{nope}', vars), /unknown placeholder \{nope\}/);
    assert.throws(() => renderTemplate('{output|nope}', vars), /unknown filter \|nope/);
    assert.throws(() => renderTemplate('{params.y}', vars), /\{params\.y\} is not set/);
  });
});

describe('custom directives', () => {
  const project = (directives: object, files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'cmdsync-'));
    writeFileSync(join(dir, 'cmdsync.json'), JSON.stringify({ directives }));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return { dir, config: resolveConfig({ cwd: dir }) };
  };
  const syntax = (directives: object) => ({ open: '<!--', close: '-->', fences: true, marker: 'M', endMarker: 'M end', directives: directives as never });
  const echo = (command: string) => ({ output: `ran ${command}\n`, status: 0 });

  it('run their command and template in the mode they build on, with params', () => {
    const directives = {
      help: { mode: 'codeblock', lang: 'text', command: '{cmd} --help' },
      stamp: { mode: 'line', template: '{params.label|default:v}: {output|trim}' },
      quote: { template: '{output|quote}' },
    };
    const { config } = project(directives);
    const input = md('<!-- M help: x -->', '<!-- M stamp label=X: y -->', 'old', '<!-- M quote start: z -->', '<!-- M end -->');
    const { content } = updateRegions(input, syntax(directives), echo, { custom: customHooks(config, join(config.root, 'a.md'), new Map()) });
    assert.equal(content, md('<!-- M help: x -->', '```text', 'ran x --help', '```', '<!-- M stamp label=X: y -->', 'X: ran y', '<!-- M quote start: z -->', '> ran z', '<!-- M end -->'));
  });

  it('a custom directive refuses unknown modes and still validates built-in options', () => {
    const directives = { quote: { template: '{output}' } };
    const { results } = updateRegions(md('<!-- M qoute: x -->', '<!-- M quote format=nope: x -->'), syntax(directives), echo);
    assert.deepEqual(results.map(r => r.kind === 'invalid' && r.reason), [
      'unknown mode "qoute" (expected region, line, codeblock, console, console-pretty, quote)',
      'unknown format "nope"',
    ]);
  });

  it('load .ts and .mjs formatters that control the whole region, and report broken ones per directive', async () => {
    const { dir, config } = project({
      pretty: { formatter: './pretty.ts' },
      shout: { formatter: './shout.mjs', template: '<{output}>' },
      broken: { formatter: './broken.mjs' },
    }, {
      // a type-only import, which Node strips, so the formatter doesn't load cmdsync's source
      'pretty.ts': `import type { FormatterContext } from ${JSON.stringify(join(import.meta.dirname, '..', 'src', 'custom.ts'))};
        const fence = (text: string, lang: string): string => '\\x60\\x60\\x60' + lang + '\\n' + text.replace(/\\n+$/, '') + '\\n\\x60\\x60\\x60';
        export default (ctx: FormatterContext): string => [fence(ctx.input, ctx.lang ?? 'sh'), '', fence(ctx.output, 'txt')].join('\\n');`,
      'shout.mjs': 'export const format = ctx => ctx.output.trim().toUpperCase() + ` ${ctx.params.end ?? ""}`;',
      'broken.mjs': 'export default 42;',
      'a.md': md('<!-- CMDSYNC pretty start lang=fish: echo hi -->', '<!-- CMDSYNC end -->', 'x <!-- CMDSYNC shout start end=yes: echo yo -->old<!-- CMDSYNC end -->', '<!-- CMDSYNC broken start: echo -->', 'keep', '<!-- CMDSYNC end -->', ''),
    });
    const formatters = await loadFormatters(config);
    const [result] = run(config, { formatters });
    assert.equal(result?.content, md(
      '<!-- CMDSYNC pretty start lang=fish: echo hi -->', '```fish', 'echo hi', '```', '', '```txt', 'hi', '```', '<!-- CMDSYNC end -->',
      'x <!-- CMDSYNC shout start end=yes: echo yo --><YO yes><!-- CMDSYNC end -->',
      '<!-- CMDSYNC broken start: echo -->', 'keep', '<!-- CMDSYNC end -->', '',
    ));
    const failed = result?.regions.find(r => r.kind === 'failed');
    assert.match(failed?.kind === 'failed' ? failed.result.error ?? '' : '', /formatter \.\/broken\.mjs: its default export .* is not a function/);
    assert.ok(dir);
  });

  it('formatters get only output, input, name, mode, lang, params, file, line and config', async () => {
    const { config } = project({ keys: { formatter: './keys.mjs', mode: 'line' } }, {
      'keys.mjs': 'export default ctx => Object.keys(ctx).join(",") + " " + ctx.input + " " + ctx.line;',
      'a.md': '<!-- CMDSYNC keys: echo hi -->\nold\n',
    });
    const [result] = run(config, { write: false, formatters: await loadFormatters(config) });
    assert.equal(result?.content, '<!-- CMDSYNC keys: echo hi -->\noutput,input,name,mode,lang,params,file,line,config echo hi 1\n');
  });

  it('config validation rejects reserved names and unknown keys', () => {
    assert.throws(() => project({ start: {} }), /invalid value for "directives"/);
    assert.throws(() => project({ x: { mode: 'nope' } }), /invalid value for "directives"/);
    assert.throws(() => project({ x: { templat: '' } }), /invalid value for "directives"/);
  });
});
