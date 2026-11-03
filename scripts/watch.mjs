#!/usr/bin/env node
/**
 * `yarn test:watch`: build and test on every change, with keys to change what runs.
 *
 * Two roles in one file:
 *   - the watcher (no arguments): nodemon (its API, configured by `nodemonConfig` in
 *     package.json) watches and restarts; this process reads single keypresses and
 *     writes the current mode to a state file
 *   - a cycle (`--cycle`, what nodemon runs): reads the mode, runs `build` and/or
 *     `test` through run-s, records the test files that failed, and prints a status line
 *
 * Arguments are test files or name patterns to start with: `yarn test:watch cli`.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { inspect, styleText } from 'node:util';

const TESTS = 'tests';
const time = () => new Date().toTimeString().slice(0, 8);

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

/**
 * @typedef {{
 *   build: boolean, typecheck: boolean, test: boolean, coverage: boolean,
 *   files: 'all' | 'failed' | 'pattern', pattern: string, failed: string[], clear: boolean,
 * }} Mode
 */

const readState = file => JSON.parse(readFileSync(file, 'utf-8'));
const writeState = (file, state) => writeFileSync(file, JSON.stringify(state));

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

/** Run a package.json script through run-s, with `args` passed on; resolves to whether it passed */
const runScript = (script, args = []) => new Promise(resolve => {
  const child = spawn('run-s', [`${script} {@}`, '--', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', code => resolve(code === 0));
});

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

// ── a cycle, run by nodemon ───────────────────────────────────────────────────

async function cycle(stateFile) {
  const state = readState(stateFile);
  if (state.clear) process.stdout.write('\x1bc');
  console.log(`${time().white} - ${describe(state)}`.dim);
  const start = performance.now();

  let ok = true;
  if (state.build) ok = await runScript('build');
  if (ok && state.typecheck) ok = await runScript('typecheck');
  let files = [];
  if (ok && state.test) {
    files = state.files === 'failed' ? state.failed : state.files === 'pattern' ? matching(state.pattern) : [];
    if (state.files !== 'all' && files.length === 0) {
      console.log(state.files === 'failed' ? 'No failed tests left: press a to run them all.' : `No test files match "${state.pattern}".`);
    } else {
      const tap = join(tmpdir(), `cmdsync-watch-${process.ppid}.tap`);
      ok = await runScript(state.coverage ? 'test:coverage' : 'test', ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${tap}`, ...files]);
      try {
        // what failed this time, for `f`; a run that passed clears it
        writeState(stateFile, { ...readState(stateFile), failed: ok ? [] : failedFiles(readFileSync(tap, 'utf-8')) });
        rmSync(tap, { force: true });
      } catch {
        // the watcher quit meanwhile
      }
    }
  }
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  const what = describe(state);
  console.log(`\n${time()} - ${ok ? `✓ ${what} passed`.green : `✗ ${what} failed`.red} in ${seconds}s. ${'Watching for changes; h for keys.'.dim}`);
  process.exitCode = ok ? 0 : 1;
}

// ── the watcher ───────────────────────────────────────────────────────────────

async function watch(args) {
  const { default: nodemon } = await import('nodemon');
  const stateFile = join(tmpdir(), `cmdsync-watch-${process.pid}.json`);
  /** @type {Mode} */
  let mode = { build: true, typecheck: false, test: true, coverage: false, files: args.length ? 'pattern' : 'all', pattern: args.join(' '), failed: [], clear: false };
  writeState(stateFile, mode);

  const update = change => {
    mode = { ...readState(stateFile), ...change };
    writeState(stateFile, mode);
  };
  /** Switch mode (or not) and run now: a run in progress is stopped first, so pressing a key mid-run starts over */
  const rerun = change => {
    if (change) update(change);
    console.log(`\n${time()} - ${running ? 'stopping the run in progress, then ' : ''}running ${describe(mode)}`.dim);
    nodemon.emit('restart');
  };
  /** Whether a cycle is running, from nodemon's start/exit/crash events */
  let running = false;

  const quit = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    nodemon.emit('quit');
    rmSync(stateFile, { force: true });
    setTimeout(() => process.exit(0), 200);
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
          update({ clear: !mode.clear });
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

  // watch paths, extensions and delay come from `nodemonConfig` in package.json
  nodemon({
    exec: `node ${JSON.stringify(import.meta.filename)} --cycle`,
    env: { CMDSYNC_WATCH_STATE: stateFile },
    stdin: false,
    restartable: false,
    quiet: true,
  });
  nodemon.on('start', () => { running = true; });
  nodemon.on('exit', () => { running = false; });
  nodemon.on('crash', () => { running = false; });
  nodemon.on('restart', files => {
    if (files?.length) console.log(`\n${time()} - changed: ${files.map(f => relative(process.cwd(), f)).join(' ')}`.dim.blue);
  });
  console.log('Watching src/, tests/ and examples/: press h for keys, q to quit.'.dim.magenta);
}

if (process.argv[2] === '--cycle') await cycle(process.env.CMDSYNC_WATCH_STATE);
else await watch(process.argv.slice(2));
