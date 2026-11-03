#!/usr/bin/env node
/**
 * `yarn test:watch`: build and test on every change, with keys to change what runs.
 *
 * Watches WATCH (fs.watch, recursive) and, after a change, runs `build` and/or `test`,
 * each shown as `build $ tsc -p tsconfig.json`. A change or a key pressed mid-run stops
 * the run in progress (every step runs in its own process group) and starts over.
 *
 * Arguments are test files or name patterns to start with: `yarn test:watch cli`.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, watch as fsWatch } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { inspect, styleText } from 'node:util';

/** What to watch, which files count, and how long to wait for a burst of saves to settle */
const WATCH = {
  paths: ['src/', 'tests/', 'examples/', 'package.json', 'tsconfig.json', 'cmdsync.schema.json', 'cmdsync.global.schema.json'],
  extensions: ['.ts', '.mts', '.mjs', '.js', '.json', '.md', '.mdx'],
  delay: 300,
};
const TESTS = 'tests';

/**
 * `'text'.blue`, `'text'.bold.green`, `'text'.dim.bgRed`, ...: every style `util.styleText`
 * knows (colors, `bg*`, `*Bright`, and modifiers like bold, dim, italic, underline,
 * strikethrough), each reset after the text. styleText leaves the text plain when stdout
 * isn't a terminal or NO_COLOR is set. (Replaces the legacy `String#bold()` and `#blink()`
 * HTML methods, in this script's process only.)
 */
for (const style of Object.keys(inspect.colors)) {
  Object.defineProperty(String.prototype, style, {
    configurable: true,
    get() { return styleText(style, String(this)); },
  });
}

/** The time of day, in white: `22:16:05` */
const time = () => new Date().toTimeString().slice(0, 8).white;

/**
 * @typedef {{
 *   build: boolean, typecheck: boolean, test: boolean, coverage: boolean,
 *   files: 'all' | 'failed' | 'pattern', pattern: string, failed: string[], clear: boolean,
 * }} Mode
 */

const testFiles = () => readdirSync(TESTS).filter(f => f.endsWith('.test.ts')).sort().map(f => join(TESTS, f));

/** Test files whose path contains one of the space-separated parts of `pattern` */
const matching = pattern => {
  const parts = pattern.split(/\s+/).filter(Boolean);
  return testFiles().filter(f => parts.some(p => f === p || f.includes(p)));
};

const describe = mode => {
  const steps = [mode.build && 'build', mode.typecheck && 'typecheck', mode.test && (mode.coverage ? 'test with coverage' : 'test')].filter(Boolean).join(' + ');
  const files = !mode.test ? '' : mode.files === 'all' ? 'all tests' : mode.files === 'failed' ? `failed tests (${mode.failed.length})` : `tests matching "${mode.pattern}"`;
  return [steps, files].filter(Boolean).join(', ');
};

/** Shell words, keeping quotes: `run-s 'test {@}' --` → `run-s`, `'test {@}'`, `--` */
const words = command => command.match(/'[^']*'|"(?:\\.|[^"])*"|\S+/g) ?? [];
const unquote = word => word.replace(/^(['"])([\s\S]*)\1$/, '$2');
const quote = arg => /^[\w./:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/**
 * The commands a package.json script comes down to, with `args` filled in: a
 * `run-s a 'b {@}' -- x` script expands to its tasks in order, each with `{@}`
 * replaced by the arguments; anything else is the script's command plus `args`.
 * `chain` is the scripts that led to it. package.json is read each time, since it's watched.
 */
const expand = (script, args = [], via = []) => {
  const command = JSON.parse(readFileSync('package.json', 'utf-8')).scripts[script];
  const chain = [...via, script];
  if (command === undefined) throw new Error(`no "${script}" script in package.json`);
  const parts = words(command);
  if (parts[0] !== 'run-s') return [{ chain, command: [command, ...args.map(quote)].join(' ') }];
  const separator = parts.indexOf('--');
  const tasks = (separator === -1 ? parts.slice(1) : parts.slice(1, separator)).filter(p => !p.startsWith('-')).map(unquote);
  const passed = [...separator === -1 ? [] : parts.slice(separator + 1).map(unquote), ...args];
  return tasks.flatMap(task => {
    const [name, ...rest] = task.split(/\s+/);
    return expand(name, rest.flatMap(word => word === '{@}' ? passed : [unquote(word)]), chain);
  });
};

/** Test files with a failing test, from the TAP report: each `not ok` block has a `location:` line */
const failedFiles = tap => {
  const files = new Set();
  let failing = false;
  for (const line of tap.split('\n')) {
    if (/^\s*not ok /.test(line)) failing = true;
    else if (/^\s*ok /.test(line)) failing = false;
    const location = failing && line.match(/^\s*location: '(.+?):\d+:\d+'/);
    if (location) files.add(relative(process.cwd(), location[1]));
  }
  return [...files].filter(f => f.startsWith(`${TESTS}/`));
};

// ── runs ──────────────────────────────────────────────────────────────────────

const windows = process.platform === 'win32';

/** @type {Mode} */
let mode = {
  build: true, typecheck: false, test: true, coverage: false,
  files: process.argv.length > 2 ? 'pattern' : 'all', pattern: process.argv.slice(2).join(' '), failed: [], clear: false,
};

/** The run in progress: its steps' processes, and whether it was stopped */
let current;

/** Stop the run in progress: kill each step's whole process group (the shell, node, tsc, ...) */
const stop = () => {
  if (!current) return false;
  current.stopped = true;
  for (const child of current.children) {
    try {
      process.kill(windows ? child.pid : -child.pid, 'SIGTERM');
    } catch {
      // already exited
    }
  }
  current = undefined;
  return true;
};

/**
 * Run a package.json script, with `args` passed on, showing each command it comes down to
 * as `test:coverage › test $ node --import tsx --test ...`; resolves to whether it passed.
 * The commands run directly (node_modules/.bin is on PATH under yarn), so the package
 * manager doesn't echo them a second time.
 */
const runScript = async (run, script, args = []) => {
  for (const { chain, command } of expand(script, args)) {
    if (run.stopped) return false;
    console.log(`${chain.join(' › ').bold.magenta} ${'$'.bold.blue} ${command}`);
    const ok = await new Promise(resolve => {
      const child = spawn(command, { stdio: 'inherit', shell: true, detached: !windows });
      run.children.add(child);
      child.on('exit', code => {
        run.children.delete(child);
        resolve(code === 0);
      });
    });
    if (!ok) return false;
  }
  return true;
};

/** One run of the current mode; `changed` are the files whose change started it */
async function cycle(changed = []) {
  const run = { children: new Set(), stopped: false };
  current = run;
  if (mode.clear) process.stdout.write('\x1bc');
  // printed after any clear, so they stay visible
  if (changed.length) console.log(`${time()} - ${`changed: ${changed.join(' ')}`.blue}`);
  const state = { ...mode };
  console.log(`${time()} - ${describe(state)}`.dim);
  const start = performance.now();

  let ok = true;
  if (state.build) ok = await runScript(run, 'build');
  if (ok && state.typecheck) ok = await runScript(run, 'typecheck');
  if (ok && state.test) {
    const files = state.files === 'failed' ? state.failed : state.files === 'pattern' ? matching(state.pattern) : [];
    if (state.files !== 'all' && files.length === 0) {
      console.log(state.files === 'failed' ? 'No failed tests left: press a to run them all.' : `No test files match "${state.pattern}".`);
    } else {
      const tap = join(tmpdir(), `cmdsync-watch-${process.pid}.tap`);
      ok = await runScript(run, state.coverage ? 'test:coverage' : 'test', ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${tap}`, ...files]);
      // what failed this time, for `f`; a run that passed clears it
      if (!run.stopped) mode.failed = ok ? [] : existsSync(tap) ? failedFiles(readFileSync(tap, 'utf-8')) : [];
      rmSync(tap, { force: true });
    }
  }
  // a stopped run says nothing: the run that replaced it reports instead
  if (run.stopped) return;
  current = undefined;
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const what = describe(state);
  console.log(`\n${time()} - ${ok ? `✓ ${what} passed`.green : `✗ ${what} failed`.red} in ${seconds}s. ${'Watching for changes; h for keys.'.dim}`);
}

/** Switch mode (or not) and run now; a run in progress is stopped first, so pressing a key mid-run starts over */
const rerun = (change = {}, changed = []) => {
  mode = { ...mode, ...change };
  const stopped = stop();
  if (!changed.length) console.log(`\n${time()} - ${stopped ? 'stopping the run in progress, then ' : ''}running ${describe(mode)}`.dim);
  cycle(changed);
};

// ── watching ──────────────────────────────────────────────────────────────────

/** Files changed since the last run started, collected for WATCH.delay so a burst of saves is one run */
const pending = new Set();
let timer;
const changedFile = file => {
  if (!WATCH.extensions.includes(extname(file))) return;
  pending.add(relative(process.cwd(), file));
  clearTimeout(timer);
  timer = setTimeout(() => {
    const changed = [...pending].sort();
    pending.clear();
    rerun({}, changed);
  }, WATCH.delay);
};

const watched = WATCH.paths.filter(p => existsSync(p));
const watchers = watched.map(path => {
  const directory = statSync(path).isDirectory();
  return fsWatch(path, { recursive: directory }, (_event, file) => changedFile(directory ? join(path, file ?? '') : path));
});

// ── keys ──────────────────────────────────────────────────────────────────────

const quit = () => {
  stop();
  watchers.forEach(w => w.close());
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
};

const help = () => console.log([
  '',
  `${'Watch keys'.bold} ${`(now: ${describe(mode)}${mode.clear ? ', clearing' : ''})`.dim}`,
  '  r, Enter  run again (stops a run in progress)',
  '  a         run all tests',
  '  f         run only the test files that failed',
  '  p         run only test files matching a pattern',
  '  b         build only (no tests)',
  '  t         tests only (no build)',
  '  v         build and tests (the default)',
  '  k         typecheck only (tsc --noEmit)',
  '  o         tests with coverage (toggle)',
  '  c         clear the screen before each run (toggle)',
  '  q, Ctrl-C quit',
  '  h         show this',
  '',
].join('\n'));

/** While a prompt is open, the keys typed are its answer, not commands */
let prompting = false;
const ask = question => new Promise(resolve => {
  prompting = true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const done = answer => {
    rl.close();
    prompting = false;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    resolve(answer.trim());
  };
  // Ctrl-C cancels the prompt (q and Ctrl-C quit again once it's closed)
  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    done('');
  });
  rl.question(question, done);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async key => {
    if (prompting) return;
    switch (key) {
      case '\u0003': case 'q': return quit();
      case 'r': case '\r': return rerun();
      case 'a': return rerun({ files: 'all', test: true });
      case 'f': return rerun({ files: 'failed', test: true });
      case 'b': return rerun({ build: true, typecheck: false, test: false });
      case 't': return rerun({ build: false, typecheck: false, test: true });
      case 'v': return rerun({ build: true, typecheck: false, test: true });
      case 'k': return rerun({ build: false, typecheck: true, test: false });
      case 'o': return rerun({ coverage: !mode.coverage, test: true });
      case 'c':
        mode.clear = !mode.clear;
        return console.log(`clearing the screen before each run: ${mode.clear ? 'on' : 'off'}`.dim);
      case 'p': {
        const pattern = await ask('test file pattern (e.g. cli, tests/diff.test.ts): ');
        if (!pattern) return console.log('no pattern, nothing changed'.dim);
        const found = matching(pattern);
        console.log((found.length ? `→ ${found.join(' ')}` : `no test files match "${pattern}"`).dim);
        return rerun({ files: 'pattern', pattern, test: true });
      }
      case 'h': case '?': return help();
    }
  });
} else {
  console.log('stdin is not a terminal: keys are off'.dim);
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

console.log(` Watching: `.bold.bgGreen.black.italic + `\n\n    ${watched.join('\n    ').blue}` + `\n\npress h for keys, q to quit`.dim.magenta);
cycle();
