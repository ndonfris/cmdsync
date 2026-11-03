/**
 * The test reporter for `yarn test`: each file as a tree of its suites and tests
 * (`├─`/`└─`), every row marked ✓ passed, ✗ failed or - skipped (a suite or file fails
 * when anything in it did), tests with their time rounded, failures in full at the end,
 * then a one-line summary. Also renders the coverage table
 * for `yarn test:coverage`.
 *
 *   node --test --test-reporter=./tests/reporter.mjs --test-reporter-destination=stdout
 *
 * (Not named *.test.* / test-*, so `node --test` doesn't run it as a test file.)
 */
import { relative } from 'node:path';
import { inspect, styleText } from 'node:util';

const paint = (style, text) => styleText(style, text);
const cwd = process.cwd();
const path = file => file ? relative(cwd, file) || file : '';

/** `0.4ms` → `<1ms`, `203.84ms` → `203ms`, `14213ms` → `14.2s` */
const duration = ms => ms === undefined ? '' : ms < 1 ? '<1ms' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
const time = ms => ms === undefined ? '' : `  ${paint('dim', duration(ms))}`;

/** `[1, 2, 3, 7, 9, 10]` → `1-3 7 9-10` */
const ranges = numbers => {
  const out = [];
  for (const n of numbers) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(' ');
};

/** The assertion behind a failure (node wraps it in ERR_TEST_FAILURE), as text */
const describeError = error => {
  const cause = error?.code === 'ERR_TEST_FAILURE' && error.cause ? error.cause : error;
  if (!cause) return '';
  const text = cause instanceof Error ? (cause.stack ?? String(cause)) : inspect(cause);
  // drop node:internal and node_modules frames, which only point at the test runner
  return text.split('\n').filter(line => !/^\s+at (.*(node:internal|node_modules|node:async_hooks)|async Promise\.all)/.test(line)).join('\n');
};

function coverageTable({ files, totals }) {
  const percent = n => `${n.toFixed(1).padStart(5)}%`;
  const color = n => n >= 90 ? 'green' : n >= 75 ? 'yellow' : 'red';
  const width = Math.max(10, ...files.map(f => path(f.path).length));
  const row = (name, f, uncovered = '') => [
    name.padEnd(width),
    paint(color(f.coveredLinePercent), percent(f.coveredLinePercent)),
    paint(color(f.coveredBranchPercent), percent(f.coveredBranchPercent)),
    paint(color(f.coveredFunctionPercent), percent(f.coveredFunctionPercent)),
    paint('dim', uncovered),
  ].join('  ');
  const header = ['file'.padEnd(width), ' lines', 'branch', ' funcs', 'uncovered lines'].join('  ');
  return [
    '',
    paint('bold', header),
    ...files.map(f => row(path(f.path), f, ranges(f.lines.filter(l => l.count === 0).map(l => l.line)))),
    paint('bold', row('all files', totals)),
  ].join('\n');
}

/**
 * @typedef {{
 *   name: string, children: Node[], suite?: boolean, ms?: number,
 *   status?: 'pass' | 'fail' | 'skip' | 'todo', reason?: string,
 * }} Node
 */

const MARK = { pass: ['green', '✓'], fail: ['red', '✗'], skip: ['dim', '-'], todo: ['dim', '-'] };
/** A suite (or file) failed when anything in it did */
const failed = node => node.status === 'fail' || node.children.some(failed);

/** A file's results as a tree: `├─`/`└─` per child, `│` continuing the parent's line */
function tree(file, roots) {
  // a file's time: its top-level tests and suites (each file runs in its own process, which node doesn't time)
  const total = roots.reduce((sum, node) => sum + (node.ms ?? 0), 0);
  const lines = [`${paint(...MARK[roots.some(failed) ? 'fail' : 'pass'])} ${paint('bold', file)}${time(total)}`];
  const walk = (nodes, prefix) => nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    const branch = paint('dim', `${prefix}${last ? '└─' : '├─'} `);
    const status = node.suite ? (failed(node) ? 'fail' : 'pass') : node.status ?? 'pass';
    const muted = status === 'skip' || status === 'todo';
    const name = muted ? paint('dim', `${node.name} (${status === 'todo' ? 'todo' : 'skipped'}${node.reason ? `: ${node.reason}` : ''})`)
      : status === 'fail' && !node.suite ? paint('red', node.name)
      : node.name;
    lines.push(`${branch}${paint(...MARK[status])} ${name}${muted ? '' : time(node.ms)}`);
    walk(node.children, `${prefix}${last ? '   ' : '│  '}`);
  });
  walk(roots, '');
  return `\n${lines.join('\n')}\n`;
}

export default async function* reporter(events) {
  /** The current file's top-level tests and suites, and the ones started but not finished (innermost last) */
  let file;
  let roots = [];
  const stack = [];
  const failures = [];
  const summary = {};
  /** Files and suites seen, and how many failed, for the summary */
  const counted = { files: 0, failedFiles: 0, suites: 0, failedSuites: 0 };
  const countSuites = nodes => nodes.forEach(node => {
    if (node.suite) {
      counted.suites++;
      if (failed(node)) counted.failedSuites++;
    }
    countSuites(node.children);
  });
  const started = new Date();
  const flush = () => {
    if (file && roots.length) {
      counted.files++;
      if (roots.some(failed)) counted.failedFiles++;
      countSuites(roots);
    }
    const out = file && roots.length ? tree(file, roots) : '';
    roots = [];
    stack.length = 0;
    return out;
  };

  for await (const { type, data } of events) {
    switch (type) {
      case 'test:start': {
        // node reports one file at a time: a new file means the last one is complete
        if (data.file && path(data.file) !== file) {
          const out = flush();
          file = path(data.file);
          if (out) yield out;
        }
        stack.length = data.nesting;
        const node = { name: data.name, children: [] };
        (stack.at(-1)?.children ?? roots).push(node);
        stack.push(node);
        break;
      }

      case 'test:pass':
      case 'test:fail': {
        stack.length = data.nesting + 1;
        const node = stack.pop();
        if (!node) break;
        node.suite = data.details?.type === 'suite';
        node.ms = data.details?.duration_ms;
        if (data.skip !== undefined || data.todo !== undefined) {
          node.status = data.todo !== undefined ? 'todo' : 'skip';
          node.reason = [data.skip, data.todo].find(r => typeof r === 'string');
        } else {
          node.status = type === 'test:pass' ? 'pass' : 'fail';
        }
        if (node.status === 'fail' && !node.suite) {
          failures.push({
            title: [...stack.map(s => s.name), data.name].join(' › '),
            at: `${path(data.file)}${data.line ? `:${data.line}:${data.column}` : ''}`,
            error: describeError(data.details?.error),
          });
        }
        break;
      }

      case 'test:stdout':
      case 'test:stderr':
        yield paint('dim', data.message);
        break;

      case 'test:diagnostic': {
        const [key, value] = data.message.split(' ');
        if (/^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)$/.test(key)) summary[key] = Number(value);
        else yield `${paint('yellow', data.message)}\n`;
        break;
      }

      case 'test:coverage':
        yield `${flush()}${coverageTable(data.summary)}\n`;
        break;
    }
  }

  yield flush();
  let out = '';
  for (const [i, f] of failures.entries()) {
    out += `\n${paint(['bold', 'red'], `${i + 1}) ${f.title}`)}\n${paint('dim', f.at)}\n${f.error.replace(/^/gm, '   ')}\n`;
  }
  /** `Tests   2 failed, 158 passed, 1 skipped (161)`: the non-zero counts, then the total */
  const row = (label, total, counts) => {
    const parts = [
      counts.failed ? paint(['bold', 'red'], `${counts.failed} failed`) : '',
      counts.passed ? paint(failedAny ? 'green' : ['bold', 'green'], `${counts.passed} passed`) : '',
      ...['skipped', 'todo', 'cancelled'].map(k => counts[k] ? paint('dim', `${counts[k]} ${k}`) : ''),
    ].filter(Boolean);
    return ` ${paint('bold', label.padEnd(6))}  ${parts.join(', ') || paint('dim', 'none')} ${paint('dim', `(${total})`)}`;
  };
  const failedAny = (summary.fail ?? 0) + (summary.cancelled ?? 0) + counted.failedFiles > 0;
  out += [
    '',
    row('Files', counted.files, { failed: counted.failedFiles, passed: counted.files - counted.failedFiles }),
    row('Suites', counted.suites, { failed: counted.failedSuites, passed: counted.suites - counted.failedSuites }),
    row('Tests', summary.tests ?? 0, { failed: summary.fail, passed: summary.pass, skipped: summary.skipped, todo: summary.todo, cancelled: summary.cancelled }),
    ` ${paint('bold', 'Time'.padEnd(6))}  ${duration(summary.duration_ms) || '0ms'}  ${paint('dim', `(started ${started.toTimeString().slice(0, 8)})`)}`,
    '',
  ].join('\n');
  yield out;
}
