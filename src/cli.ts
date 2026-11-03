#!/usr/bin/env node
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type UserConfig, resolveConfig } from './config.js';
import { completionScript } from './completions.js';
import { gitRoot, gitStatus, installHook, stage } from './git.js';
import { type FileResult, type InstallEvent, type RegionResult, directiveSource, displayPath, missingBinaries, run, unifiedDiff } from './index.js';
import { PARSE_OPTIONS, SHELLS, type Shell } from './options.js';

const HELP = `\
Usage: cmdsync [options] [paths...]
       cmdsync lint [options] [paths...]
       cmdsync completions <bash|zsh|fish|nu>
       cmdsync hook install

Replace comment-delimited regions of any file with the output of the
command named in the start comment:

  <!-- CMDSYNC start: my-cli --version -->
  this line is replaced with the output of \`my-cli --version\`
  <!-- CMDSYNC end -->

In markdown, \`<!-- CMDSYNC codeblock: cmd -->\` followed by a fenced code
block replaces just the body of that block, and no end comment is needed.

Arguments:
  paths                    Files or directories to process
                           (default: the config's "include" globs)

Commands:
  lint [paths...]          Check every directive without running commands or
                           writing, and list where each one is: invalid
                           options, missing end markers or includes, commands
                           outside "commands", stray markers (exit 1), and
                           binaries that aren't on PATH (warning)
  completions <shell>      Print a completion script for bash, zsh, fish or nu
  hook install             Add \`cmdsync --staged\` to the git pre-commit hook
                           (prints the line to add if a hook already exists)

Options:
  -c, --config <file>      Config file (cmdsync.json or package.json)
      --check              Don't write; exit 1 if any region is out of date
  -n, --dry-run            Don't write; report what would change
  -d, --diff               Don't write; print a unified diff of what would
                           change, and exit 1 if anything is out of date
      --staged             Write, then \`git add\` the files that changed; refuses
                           files with unstaged changes (for a pre-commit hook)
  -m, --marker <name>      Start marker (overrides config)
  -e, --end-marker <name>  End marker (overrides config, default: "<marker> end")
      --comment <delims>   Comment delimiters for every file, e.g. '#' or '/* */'
                           (overrides config and the built-in syntax table)
  -s, --shell <bin>        Shell used to run commands (overrides config)
      --command <bin>      Allowed command binary, repeatable (overrides config)
      --install            Run the config's "install" command for every binary
                           a directive uses, even if it's already on PATH
      --no-install         Never run "install" commands (default: only for
                           binaries that aren't on PATH)
  -q, --quiet              Only print errors
  -h, --help               Show this help
  -v, --version            Show version

Directives: <!-- CMDSYNC [mode] [start] [format=...] [lang=...]: cmd -->
            <!-- CMDSYNC [mode] [start] [...] include=path[#L1-L9] -->
  region     replace every line up to <!-- CMDSYNC end -->
             (\`start\` is short for \`region start\`; on one line: inline)
  line       replace the next line (output must be one line)
  codeblock  replace the body of the next fenced code block (markdown)
             (lang=fish sets its language, creating the block if missing)
  (none)     codeblock if a fence follows in markdown, inline if the end
             marker is on the same line, else region
  format=md-table|html-table  render a JSON array printed by cmd as a table
  include=path#L10-L20        content from a file (relative to this one)
                              instead of a command; a line range is dedented

Config is read from the nearest cmdsync.json, or the "cmdsync" key of
the nearest package.json.

Exit codes: 0 success, 1 failed command, invalid directive or out of date
region (--check, --diff), 2 usage error
`;

const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

/** https://docs.github.com/actions/reference/workflow-commands-for-github-actions */
const annotate = (level: 'error' | 'warning', file: string, line: number, message: string) => {
  const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} file=${escape(file)},line=${line},title=cmdsync::${escape(message)}`);
};

function completions(args: string[]): number {
  const [shell] = args;
  if (args.length !== 1 || !SHELLS.includes(shell as Shell)) {
    throw new Error(`usage: cmdsync completions <${SHELLS.join('|')}>`);
  }
  process.stdout.write(completionScript(shell as Shell));
  return 0;
}

function hook(args: string[]): number {
  if (args.length !== 1 || args[0] !== 'install') throw new Error('usage: cmdsync hook install');
  const result = installHook(process.cwd());
  switch (result.kind) {
    case 'created':
      console.log(`created ${result.file}\n  ${result.command}`);
      break;
    case 'already-installed':
      console.log(`cmdsync is already in ${result.file}`);
      break;
    case 'manual':
      console.log(`${result.file} already exists, so it was left untouched. Add this to it:\n\n${result.snippet.replace(/^/gm, '  ')}`);
      break;
  }
  return 0;
}

const pad = (s: string, width: number) => s.padEnd(width);

/** `cmdsync lint`: every directive and stray marker, by file and line */
function lintReport(results: FileResult[], config: ReturnType<typeof resolveConfig>, quiet: boolean): number {
  const log = (...msg: unknown[]) => quiet || console.log(...msg);
  let directives = 0;
  let errors = 0;
  let warnings = 0;
  for (const { file, original, regions, stray } of results) {
    const path = displayPath(file, config.root);
    const lines = original.split('\n');
    const entries: { line: number; print: () => void; }[] = [];
    const error = (line: number, message: string) => {
      errors++;
      if (isGithubActions) annotate('error', path, line + 1, message);
    };
    const fileErrors = regions.filter(r => r.kind !== 'updated').length + stray.length;

    for (const region of regions) {
      directives++;
      const { directive } = region;
      const source = directiveSource(directive);
      const at = (end?: number) => `${path}:${directive.line + 1}${end !== undefined && end !== directive.line ? `-${end + 1}` : ''}`;
      const mode = (r: RegionResult) => r.kind === 'updated' ? r.as : directive.options.mode ?? '';
      const row = (status: string) => `    ${pad(status, 7)}  ${at(region.kind === 'updated' ? region.end : undefined)}  ${pad(mode(region), 9)}  ${source}`;
      if (region.kind === 'updated') {
        const missing = directive.command ? missingBinaries(directive.command, config) : [];
        entries.push({
          line: directive.line,
          print: () => {
            log(row('ok'));
            if (missing.length > 0) {
              warnings++;
              const message = `${missing.join(', ')}: not on PATH, and no "install" command for ${missing.length > 1 ? 'them' : 'it'}`;
              console.warn(`    warning ${at()}  ${message}`);
              if (isGithubActions) annotate('warning', path, directive.line + 1, message);
            }
          },
        });
      } else {
        const reason = region.kind === 'invalid' ? region.reason : region.result.error ?? `exited with status ${region.result.status}`;
        entries.push({
          line: directive.line,
          print: () => {
            console.error(`${row(region.kind)}\n            ${reason}`);
            error(directive.line, reason);
          },
        });
      }
    }
    for (const line of stray) {
      const message = `mentions ${config.marker}, but isn't a directive or an end marker that closes one`;
      entries.push({
        line,
        print: () => {
          console.error(`    stray    ${path}:${line + 1}  ${lines[line]!.trim()}\n            ${message}`);
          error(line, message);
        },
      });
    }

    log(`${fileErrors > 0 ? '✗' : '✓'} ${path}`);
    for (const entry of entries.sort((a, b) => a.line - b.line)) entry.print();
  }
  log(`\n${results.length} file(s), ${directives} directive(s), ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

function main(argv: string[]): number {
  if (argv[0] === 'completions') return completions(argv.slice(1));
  if (argv[0] === 'hook') return hook(argv.slice(1));
  const lint = argv[0] === 'lint';
  if (lint) argv = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: PARSE_OPTIONS,
  });

  if (values.help) return console.log(HELP), 0;
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return console.log(pkg.version), 0;
  }

  const overrides: UserConfig = {
    ...values.marker && { marker: values.marker },
    ...values['end-marker'] && { endMarker: values['end-marker'] },
    ...values.comment && { comment: values.comment.trim().split(/\s+/) },
    ...values.shell && { shell: values.shell },
    ...values.command && { commands: values.command },
  };
  const config = resolveConfig({ configPath: values.config, overrides });
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);
  if (lint) {
    const conflicting = (['check', 'dry-run', 'diff', 'staged', 'install'] as const).filter(o => values[o] !== undefined && values[o] !== false);
    if (conflicting.length > 0) throw new Error(`lint never runs commands or writes, so it doesn't take --${conflicting.join(', --')}`);
    log(`config: ${config.source ?? '(defaults)'}\n`);
    return lintReport(run(config, { paths: positionals, lint: true }), config, values.quiet);
  }
  if (values.staged && (values.check || values['dry-run'] || values.diff)) {
    throw new Error('--staged cannot be combined with --check, --dry-run or --diff');
  }
  // --staged writes (and stages) files itself, once it knows they're safe to stage
  const write = !values.check && !values['dry-run'] && !values.diff && !values.staged;
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const repo = values.staged ? gitRoot(config.root) : undefined;
  const git = repo ? { root: repo, ...gitStatus(repo) } : undefined;
  const toStage: string[] = [];
  let blocked = 0;

  log(`config: ${config.source ?? '(defaults)'}`);
  log(`markers: ${config.marker} … ${config.endMarker}  shell: ${config.shell}${config.commands.length ? `  commands: ${config.commands.join(', ')}` : ''}\n`);

  const report = ({ file, changed, original, content, regions }: FileResult) => {
    const path = displayPath(file, config.root);
    let written = write;
    if (git && changed) {
      const real = realpathSync(file);
      if (git.unstaged.has(real)) {
        blocked++;
        console.error(`✗ ${path} is out of date but has unstaged changes, so it can't be staged: stage or stash them, then commit again`);
        if (isGithubActions) annotate('error', path, 1, 'Out of date, and has unstaged changes');
      } else if (!git.tracked.has(real)) {
        log(`  ${path} is not tracked by git, leaving it alone`);
      } else {
        writeFileSync(file, content, 'utf-8');
        toStage.push(file);
        written = true;
      }
    }
    log(`${changed ? (written ? '✎' : '✗') : '✓'} ${path}`);
    for (const region of regions) {
      const at = `${path}:${region.directive.line + 1}`;
      switch (region.kind) {
        case 'updated':
          log(`    ${region.changed ? (written ? 'updated' : 'outdated') : 'ok'}  ${at}  ${directiveSource(region.directive)}`);
          if (region.changed && (values.check || values.diff) && isGithubActions) {
            annotate('error', path, region.directive.line + 1, `Region is out of date, run \`cmdsync\` to regenerate it (${directiveSource(region.directive)})`);
          }
          break;
        case 'failed': {
          const reason = region.result.error ?? `exited with status ${region.result.status}`;
          console.error(`    failed  ${at}  ${directiveSource(region.directive)}\n            ${reason}`);
          if (region.result.output) console.error(region.result.output.trimEnd().replace(/^/gm, '            │ '));
          if (isGithubActions) annotate('error', path, region.directive.line + 1, `\`${directiveSource(region.directive)}\` ${reason}`);
          break;
        }
        case 'invalid':
          console.error(`    invalid ${at}  ${region.reason}`);
          if (isGithubActions) annotate('error', path, region.directive.line + 1, region.reason);
          break;
      }
    }
    // the diff goes to stdout even with --quiet, since it's what was asked for
    if (values.diff && changed) process.stdout.write(`\n${unifiedDiff(original, content, { path, color })}\n`);
  };

  const onInstall = ({ bin, command, result }: InstallEvent) => {
    if (result.status === 0 && !result.error) return log(`installed ${bin}: ${command}`);
    console.error(`install failed  ${bin}: ${command}\n            ${result.error ?? `exited with status ${result.status}`}`);
    if (result.output) console.error(result.output.trimEnd().replace(/^/gm, '            │ '));
  };

  const install = values.install === undefined ? 'missing' : values.install ? 'always' : 'never';
  const results = run(config, { paths: positionals, write, install, onFile: report, onInstall });
  if (git) stage(git.root, toStage);
  const regions = results.flatMap(r => r.regions);
  const failed = regions.filter(r => r.kind !== 'updated').length;
  const stale = results.filter(r => r.changed);
  const changedRegions = regions.filter(r => r.kind === 'updated' && r.changed).length;

  const summary = [
    `${results.length} file(s), ${regions.length} directive(s)`,
    `${changedRegions} region(s) ${write ? 'updated' : 'out of date'}`,
    ...git ? [`${toStage.length} file(s) staged`] : [],
    ...failed ? [`${failed} failed`] : [],
  ].join(', ');
  log(`\n${summary}`);

  if (isGithubActions && process.env.GITHUB_STEP_SUMMARY) {
    const rows = stale.map(r => `- \`${displayPath(r.file, config.root)}\``).join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### cmdsync\n\n${summary}\n\n${rows}\n`);
  }
  if (isGithubActions && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${stale.length > 0}\nfailed=${failed}\n`);
  }

  return failed > 0 || blocked > 0 || ((values.check || values.diff) && stale.length > 0) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`cmdsync: ${(err as Error).message}`);
  process.exitCode = 2;
}
