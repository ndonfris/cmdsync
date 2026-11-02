#!/usr/bin/env node
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type UserConfig, resolveConfig } from './config.js';
import { completionScript } from './completions.js';
import { gitRoot, gitStatus, installHook, stage } from './git.js';
import { type FileResult, type InstallEvent, displayPath, run } from './index.js';
import { PARSE_OPTIONS, SHELLS, type Shell } from './options.js';

const HELP = `\
Usage: cmdsync [options] [paths...]
       cmdsync completions <bash|zsh|fish|nu>
       cmdsync hook install

Replace comment-delimited regions of any file with the output of the
command named in the start comment:

  <!-- CMDSYNC region: my-cli --version -->
  this line is replaced with the output of \`my-cli --version\`
  <!-- /CMDSYNC -->

In markdown, \`<!-- CMDSYNC codeblock: cmd -->\` followed by a fenced code
block replaces just the body of that block, and no end comment is needed.

Arguments:
  paths                    Files or directories to process
                           (default: the config's "include" globs)

Commands:
  completions <shell>      Print a completion script for bash, zsh, fish or nu
  hook install             Add \`cmdsync --staged\` to the git pre-commit hook
                           (prints the line to add if a hook already exists)

Options:
  -c, --config <file>      Config file (cmdsync.json or package.json)
      --check              Don't write; exit 1 if any region is out of date
  -n, --dry-run            Don't write; report what would change
      --staged             Write, then \`git add\` the files that changed; refuses
                           files with unstaged changes (for a pre-commit hook)
  -m, --marker <name>      Start marker (overrides config)
  -e, --end-marker <name>  End marker (overrides config, default: /<marker>)
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

Directives: <!-- CMDSYNC [mode] [format=...]: cmd -->
  region     replace every line up to <!-- /CMDSYNC -->
  line       replace the next line (output must be one line)
  codeblock  replace the body of the next fenced code block (markdown)
  (none)     codeblock if a fence follows in markdown, inline if the end
             marker is on the same line, else region
  format=md-table|html-table  render a JSON array printed by cmd as a table

Config is read from the nearest cmdsync.json, or the "cmdsync" key of
the nearest package.json.

Exit codes: 0 success, 1 failed command, invalid directive or out of date
region (--check), 2 usage error
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

function main(argv: string[]): number {
  if (argv[0] === 'completions') return completions(argv.slice(1));
  if (argv[0] === 'hook') return hook(argv.slice(1));

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
  if (values.staged && (values.check || values['dry-run'])) throw new Error('--staged cannot be combined with --check or --dry-run');
  // --staged writes (and stages) files itself, once it knows they're safe to stage
  const write = !values.check && !values['dry-run'] && !values.staged;
  const repo = values.staged ? gitRoot(config.root) : undefined;
  const git = repo ? { root: repo, ...gitStatus(repo) } : undefined;
  const toStage: string[] = [];
  let blocked = 0;
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);

  log(`config: ${config.source ?? '(defaults)'}`);
  log(`markers: ${config.marker} … ${config.endMarker}  shell: ${config.shell}${config.commands.length ? `  commands: ${config.commands.join(', ')}` : ''}\n`);

  const report = ({ file, changed, content, regions }: FileResult) => {
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
          log(`    ${region.changed ? (written ? 'updated' : 'outdated') : 'ok'}  ${at}  ${region.directive.command}`);
          if (region.changed && values.check && isGithubActions) {
            annotate('error', path, region.directive.line + 1, `Region is out of date, run \`cmdsync\` to regenerate it (${region.directive.command})`);
          }
          break;
        case 'failed': {
          const reason = region.result.error ?? `exited with status ${region.result.status}`;
          console.error(`    failed  ${at}  ${region.directive.command}\n            ${reason}`);
          if (region.result.output) console.error(region.result.output.trimEnd().replace(/^/gm, '            │ '));
          if (isGithubActions) annotate('error', path, region.directive.line + 1, `\`${region.directive.command}\` ${reason}`);
          break;
        }
        case 'invalid':
          console.error(`    invalid ${at}  ${region.reason}`);
          if (isGithubActions) annotate('error', path, region.directive.line + 1, region.reason);
          break;
      }
    }
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

  return failed > 0 || blocked > 0 || (values.check && stale.length > 0) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`cmdsync: ${(err as Error).message}`);
  process.exitCode = 2;
}
