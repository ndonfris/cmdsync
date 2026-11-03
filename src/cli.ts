#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type UserConfig, resolveConfig } from './config.js';
import { completionScript } from './completions.js';
import { gitRoot, gitStatus, installHook, stage } from './git.js';
import { contractHome, expandHome, globalConfigPath, loadGlobalConfig, repoName, saveGlobalConfig, selectRepos } from './global.js';
import { initConfig, initGlobal, removeRepo } from './init.js';
import { planMigration } from './migrate.js';
import {
  type FileResult, type InstallEvent, type RegionResult,
  directiveSource, displayPath, loadFormatters, missingBinaries, run, runPostUpdate, unifiedDiff,
} from './index.js';
import { PARSE_OPTIONS, SHELLS, type Shell } from './options.js';

const HELP = `\
Usage: cmdsync [update] [options] [paths...]
       cmdsync status [options] [paths...]
       cmdsync check [options] [paths...]
       cmdsync lint [options] [paths...]
       cmdsync init [--package-json] | init global [--add]
       cmdsync repos [list | add [path] | remove <name>]
       cmdsync migrate [--from <marker>...] [--dry-run | --diff]
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
  update [paths...]        Regenerate every directive, write the files, then run
                           the config's "postUpdate" commands (the default)
  status [paths...]        Print a diff of what \`update\` would change, without
                           writing (same as --dry-run --diff, but exits 0)
  check [paths...]         Exit 1 if any region is out of date (same as --check)
  lint [paths...]          Check every directive without running commands or
                           writing, and list where each one is: invalid
                           options, missing end markers or includes, commands
                           outside "commands", stray markers (exit 1), and
                           binaries that aren't on PATH (warning)
  init                     Create a starter cmdsync.json here (--package-json:
                           a "cmdsync" key in package.json instead)
  init global              Create the global config (--add: and add this repo)
  repos                    List the global config's repositories
  repos add [path]         Add a repository (default: this one), with
                           --name <name> and --group <group>...
  repos remove <name>      Remove a repository, by name or path
  migrate                  Convert an update-codeblocks config and directives,
                           and directives in older cmdsync syntax (/CMDSYNC,
                           CMDSYNC[format=x]:), to the current syntax
                           (--dry-run: only list, --diff: show the changes);
                           --from <marker> also converts another marker's
                           directives (<!-- DOCS: cmd -->), repeatable
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
      --post-update-cmds   Run the config's "postUpdate" commands even if no
                           file changed
      --no-post-update-cmds
                           Never run "postUpdate" commands (default: run them
                           after an update that wrote at least one file)
      --all                Run in every repository of the global config
  -g, --group <name>       Run in the global config's repositories in a group,
                           repeatable
  -r, --repo <name>        Run in a global config repository, by name or path,
                           repeatable
  -q, --quiet              Only print errors
      --verbose            Also print every file scanned, and every command run
                           with its exit status and time
  -h, --help               Show this help
  -v, --version            Show version

Directives: <!-- CMDSYNC [mode] [start] [format=...] [lang=...]: cmd -->
            <!-- CMDSYNC [mode] [start] [...] include=path[#L1-L9] -->
  region     replace every line up to <!-- CMDSYNC end -->
             (\`start\` is short for \`region start\`; on one line: inline)
  line       replace the next line (output must be one line)
  codeblock  replace the body of the next fenced code block (markdown)
             (lang=fish sets its language, creating the block if missing)
  console    the next fenced code block, as \`$ cmd\` and its output
  console-pretty  two blocks: cmd (lang=, default sh), then its output (txt)
  (none)     codeblock if a fence follows in markdown, inline if the end
             marker is on the same line, else region
  format=md-table|html-table  render a JSON array printed by cmd as a table
  include=path#L10-L20        content from a file (relative to this one)
                              instead of a command; a line range is dedented

Config is read from the nearest cmdsync.json, or the "cmdsync" key of
the nearest package.json, over the "defaults" of the global config
($CMDSYNC_GLOBAL_CONFIG, or $XDG_CONFIG_HOME/cmdsync/config.json).

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
      const base = (r: RegionResult) => r.kind === 'updated' ? r.as : directive.options.mode ?? '';
      const mode = (r: RegionResult) => directive.options.custom ? `${directive.options.custom} (${base(r)})` : base(r);
      const row = (status: string) => `    ${pad(status, 7)}  ${at(region.kind === 'updated' ? region.end : undefined)}  ${pad(mode(region), 9)}  ${source}`;
      if (region.kind === 'updated') {
        const missing = region.command ? missingBinaries(region.command, config) : [];
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

const RUN_COMMANDS = ['update', 'status', 'check', 'lint'] as const;
type RunCommand = typeof RUN_COMMANDS[number];

const parseCli = (args: string[]) => parseArgs({ args, allowPositionals: true, allowNegative: true, options: PARSE_OPTIONS });
type Values = ReturnType<typeof parseCli>['values'];

function init(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'package-json': { type: 'boolean', default: false },
      add: { type: 'boolean', default: false },
      name: { type: 'string' },
      group: { type: 'string', multiple: true },
    },
  });
  if (positionals[0] === 'global') {
    if (positionals.length > 1 || values['package-json']) throw new Error('usage: cmdsync init global [--add [--name <name>] [--group <group>...]]');
    const add = values.add ? { path: contractHome(gitRootOrCwd()), ...values.name && { name: values.name }, ...values.group && { groups: values.group } } : undefined;
    const result = initGlobal({ add });
    console.log(result.created ? `created ${result.file}` : `${result.file} already exists`);
    if (add) console.log(result.added ? `added ${repoName(add)} (${add.path})` : `${add.path} is already in it`);
    if (result.created) console.log('\nIts "defaults" apply to every repository; add repositories with `cmdsync repos add`, then run them with `cmdsync --all`.');
    return 0;
  }
  if (positionals.length > 0 || values.add || values.name || values.group) {
    throw new Error('usage: cmdsync init [--package-json] | cmdsync init global [--add ...]');
  }
  const result = initConfig(process.cwd(), { packageJson: values['package-json'] });
  switch (result.kind) {
    case 'exists':
      console.log(`already configured: ${result.file}`);
      return 0;
    case 'legacy':
      console.error(`${result.file} is an update-codeblocks config: run \`cmdsync migrate\` to convert it`);
      return 1;
    case 'created':
      console.log(`created ${result.file}

Next:
  1. add a directive to a markdown file:
       <!-- CMDSYNC start: your-cli --help -->
       <!-- CMDSYNC end -->
  2. run \`cmdsync\` to fill it in (\`cmdsync status\` to preview, \`cmdsync check\` in CI)
  3. \`cmdsync hook install\` to regenerate on every commit`);
      return 0;
  }
}

/** Repository root of the cwd, or the cwd outside of git */
function gitRootOrCwd(): string {
  try {
    return gitRoot(process.cwd());
  } catch {
    return process.cwd();
  }
}

function repos(args: string[]): number {
  const usage = 'usage: cmdsync repos [list] | repos add [path] [--name <name>] [--group <group>...] | repos remove <name|path>';
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: 'string' }, group: { type: 'string', multiple: true } },
  });
  const [action = 'list', ...rest] = positionals;
  const file = globalConfigPath();
  const global = loadGlobalConfig(file);
  switch (action) {
    case 'list': {
      if (rest.length > 0) throw new Error(usage);
      if (!global?.repos?.length) {
        console.log(global ? `no repos in ${file}` : `no global config at ${file}: create it with \`cmdsync init global\``);
        return 0;
      }
      const width = Math.max(...global.repos.map(r => repoName(r).length));
      for (const repo of global.repos) {
        const missing = existsSync(expandHome(repo.path)) ? '' : '  (missing)';
        console.log(`${repoName(repo).padEnd(width)}  ${repo.path}${repo.groups?.length ? `  [${repo.groups.join(', ')}]` : ''}${missing}`);
      }
      return 0;
    }
    case 'add': {
      if (rest.length > 1) throw new Error(usage);
      const path = rest[0] ? resolve(expandHome(rest[0])) : gitRootOrCwd();
      if (!existsSync(path)) throw new Error(`${path} does not exist`);
      const repo = { path: contractHome(path), ...values.name && { name: values.name }, ...values.group && { groups: values.group } };
      const result = initGlobal({ add: repo });
      console.log(result.added ? `added ${repoName(repo)} (${repo.path}) to ${result.file}` : `${repo.path} is already in ${result.file}`);
      return 0;
    }
    case 'remove': {
      if (rest.length !== 1 || !global) throw new Error(global ? usage : `no global config at ${file}`);
      const removed = removeRepo(global, rest[0]!);
      if (!removed) throw new Error(`no repo named "${rest[0]}" in ${file}`);
      saveGlobalConfig(global, file);
      console.log(`removed ${repoName(removed)} (${removed.path})`);
      return 0;
    }
    default:
      throw new Error(usage);
  }
}

function migrate(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      'dry-run': { type: 'boolean', short: 'n', default: false },
      diff: { type: 'boolean', short: 'd', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      from: { type: 'string', short: 'f', multiple: true },
    },
  });
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);
  const root = gitRootOrCwd();
  const plan = planMigration(root, { from: values.from });
  const write = !values['dry-run'] && !values.diff;
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  if (plan.files.length === 0 && plan.notes.length === 0) {
    log('nothing to migrate: no update-codeblocks config, and no directives in an old syntax');
    return 0;
  }
  for (const { file, before, after, notes } of plan.files) {
    const path = displayPath(file, root);
    const verb = after === null ? 'delete' : before === '' ? 'create' : after === before ? 'check' : 'update';
    log(`${write ? { delete: 'deleted', create: 'created', update: 'updated', check: 'check' }[verb] : verb}  ${path}${notes.length ? `  (${notes.join('; ')})` : ''}`);
    if (values.diff && after !== null && after !== before) process.stdout.write(`\n${unifiedDiff(before, after, { path, color })}\n`);
    if (!write || after === before) continue;
    if (after === null) rmSync(file);
    else writeFileSync(file, after);
  }
  if (plan.notes.length > 0) console.log(`\nBy hand:\n${plan.notes.map(n => `  - ${n}`).join('\n')}`);
  if (write) log('\nRun `cmdsync lint` to check every directive, then `cmdsync status` to see what regenerating would change.');
  return values.diff && plan.files.some(f => f.after !== f.before) ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'completions') return completions(argv.slice(1));
  if (argv[0] === 'migrate') return migrate(argv.slice(1));
  if (argv[0] === 'hook') return hook(argv.slice(1));
  if (argv[0] === 'init') return init(argv.slice(1));
  if (argv[0] === 'repos') return repos(argv.slice(1));
  const subcommand = RUN_COMMANDS.includes(argv[0] as RunCommand) ? argv[0] as RunCommand : undefined;
  if (subcommand) argv = argv.slice(1);

  const { values, positionals } = parseCli(argv);

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
  const global = loadGlobalConfig();
  if (global?.defaults && Object.keys(global.defaults).length > 0 && !values.quiet) console.log(`global: ${globalConfigPath()}`);
  const multi = values.all || !!values.group?.length || !!values.repo?.length;
  if (!multi) return await runIn(resolveConfig({ configPath: values.config, overrides, defaults: global?.defaults }), values, positionals, subcommand);

  if (!global) throw new Error(`--all, --group and --repo need a global config, and there's none at ${globalConfigPath()}: create it with \`cmdsync init global\``);
  if (positionals.length > 0 || values.config || values.staged) {
    throw new Error('--all, --group and --repo run each repository with its own config, so they can\'t be combined with paths, --config or --staged');
  }
  const selected = selectRepos(global, { all: values.all, groups: values.group, repos: values.repo });
  let code = 0;
  let failed = 0;
  for (const [i, repo] of selected.entries()) {
    const dir = expandHome(repo.path);
    if (!values.quiet) console.log(`${i === 0 ? '' : '\n'}━━ ${repoName(repo)}  ${repo.path}`);
    try {
      if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
      const result = await runIn(resolveConfig({ cwd: dir, overrides, defaults: global.defaults }), values, [], subcommand);
      if (result !== 0) failed++;
      code = Math.max(code, result);
    } catch (err) {
      console.error(`cmdsync: ${repoName(repo)}: ${(err as Error).message}`);
      failed++;
      code = Math.max(code, 1);
    }
  }
  if (!values.quiet) console.log(`\n${selected.length} repo(s)${failed ? `, ${failed} with errors or out of date` : ''}`);
  return code;
}

/** One run (update, status, check or lint) with one config */
async function runIn(config: ReturnType<typeof resolveConfig>, values: Values, positionals: string[], subcommand: RunCommand | undefined): Promise<number> {
  const lint = subcommand === 'lint';
  const formatters = await loadFormatters(config);
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);
  if (values.quiet && values.verbose) throw new Error('--quiet and --verbose cannot be combined');
  const verbose = (...msg: unknown[]) => values.verbose && console.log(...msg);
  /** Flags given that `subcommand` already decides */
  const given = (names: readonly ('check' | 'dry-run' | 'diff' | 'staged')[]) => names.filter(n => values[n]);
  const conflicts = {
    update: given(['check', 'dry-run', 'diff']),
    status: given(['check', 'staged']),
    check: given(['staged']),
  } as const;
  if (subcommand && subcommand !== 'lint' && conflicts[subcommand].length > 0) {
    const hint = subcommand === 'update' ? ' (use `cmdsync status` or `cmdsync check` instead)' : '';
    throw new Error(`\`${subcommand}\` doesn't take --${conflicts[subcommand].join(', --')}${hint}`);
  }
  const check = values.check || subcommand === 'check';
  const status = subcommand === 'status';
  const dryRun = values['dry-run'] || status;
  const diff = values.diff || status;
  if (lint) {
    const conflicting = (['check', 'dry-run', 'diff', 'staged', 'install', 'post-update-cmds'] as const).filter(o => values[o] !== undefined && values[o] !== false);
    if (conflicting.length > 0) throw new Error(`lint never runs commands or writes, so it doesn't take --${conflicting.join(', --')}`);
    log(`config: ${config.source ?? '(defaults)'}\n`);
    return lintReport(run(config, { paths: positionals, lint: true, formatters }), config, values.quiet);
  }
  if (values.staged && (check || dryRun || diff)) {
    throw new Error('--staged cannot be combined with --check, --dry-run or --diff');
  }
  // --staged writes (and stages) files itself, once it knows they're safe to stage
  const write = !check && !dryRun && !diff && !values.staged;
  if (values['post-update-cmds'] && !write && !values.staged) {
    throw new Error('--post-update-cmds only applies to an update that writes files');
  }
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const repo = values.staged ? gitRoot(config.root) : undefined;
  const git = repo ? { root: repo, ...gitStatus(repo) } : undefined;
  const toStage: string[] = [];
  let blocked = 0;

  log(`config: ${config.source ?? '(defaults)'}`);
  log(`markers: ${config.marker} … ${config.endMarker}  shell: ${config.shell}${config.commands.length ? `  commands: ${config.commands.join(', ')}` : ''}${values.verbose ? '' : '\n'}`);
  verbose(`root: ${config.root}  cwd: ${config.cwd}  timeout: ${config.timeout}ms`);
  verbose(`include: ${config.include.join(' ')}  exclude: ${config.exclude.join(' ')}`);
  if (Object.keys(config.env).length) verbose(`env: ${Object.keys(config.env).join(', ')}`);
  if (Object.keys(config.install).length) verbose(`install: ${Object.keys(config.install).join(', ')}`);
  if (config.postUpdate.length) verbose(`postUpdate: ${config.postUpdate.join(' ; ')}`);
  verbose('');

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
          if (region.changed && (check || diff) && isGithubActions) {
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
    if (diff && changed) process.stdout.write(`\n${unifiedDiff(original, content, { path, color })}\n`);
  };

  const onInstall = ({ bin, command, result }: InstallEvent) => {
    if (result.status === 0 && !result.error) return log(`installed ${bin}: ${command}`);
    console.error(`install failed  ${bin}: ${command}\n            ${result.error ?? `exited with status ${result.status}`}`);
    if (result.output) console.error(result.output.trimEnd().replace(/^/gm, '            │ '));
  };

  const onScan = (file: string, syntax: { open: string; close: string; fences: boolean; }) =>
    verbose(`  scan  ${displayPath(file, config.root)}  (${[syntax.open, syntax.close].filter(Boolean).join(' ')}${syntax.fences ? ', markdown' : ''})`);
  const onCommand = (command: string, result: { status: number; error?: string; }, ms: number) =>
    verbose(`  $ ${command}  → ${result.error ?? `exit ${result.status}`} in ${Math.round(ms)}ms`);

  const install = values.install === undefined ? 'missing' : values.install ? 'always' : 'never';
  const results = run(config, {
    paths: positionals, write, install, formatters, onFile: report, onInstall,
    ...values.verbose && { onScan, onCommand },
  });

  // postUpdate commands run after files are written, and (with --staged) before they're staged,
  // so whatever they change in those files is committed too
  const written = git ? toStage : results.filter(r => r.written).map(r => r.file);
  const postUpdate = values['post-update-cmds'];
  const runPost = (write || !!git) && config.postUpdate.length > 0 && postUpdate !== false && (postUpdate || written.length > 0);
  let postFailed = false;
  if (runPost) {
    log('');
    for (const { command, result } of runPostUpdate(config, written)) {
      if (result.status === 0 && !result.error) {
        log(`postUpdate  ${command}`);
        if (values.verbose && result.output.trim()) console.log(result.output.trimEnd().replace(/^/gm, '            │ '));
        continue;
      }
      postFailed = true;
      console.error(`postUpdate failed  ${command}\n            ${result.error ?? `exited with status ${result.status}`}`);
      if (result.output) console.error(result.output.trimEnd().replace(/^/gm, '            │ '));
      if (isGithubActions) annotate('error', displayPath((config.source ?? 'cmdsync.json').replace(/#.*/, ''), config.root), 1, `postUpdate \`${command}\` failed`);
    }
  }
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

  return failed > 0 || blocked > 0 || postFailed || ((check || (diff && !status)) && stale.length > 0) ? 1 : 0;
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  (err: Error) => {
    console.error(`cmdsync: ${err.message}`);
    process.exitCode = 2;
  },
);
