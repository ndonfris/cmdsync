#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type UserConfig, resolveConfig } from './config.js';
import { type FileResult, type InstallEvent, displayPath, run } from './index.js';

const HELP = `\
Usage: cmdsync [options] [paths...]

Replace comment-delimited regions of any file with the output of the
command named in the start comment:

  <!-- CMDSYNC: my-cli --version -->
  this line is replaced with the output of \`my-cli --version\`
  <!-- /CMDSYNC -->

In markdown, a start comment followed by a fenced code block replaces just
the body of that block, and no end comment is needed.

Arguments:
  paths                    Files or directories to process
                           (default: the config's "include" globs)

Options:
  -c, --config <file>      Config file (cmdsync.json or package.json)
      --check              Don't write; exit 1 if any region is out of date
  -n, --dry-run            Don't write; report what would change
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

Directive options: <!-- CMDSYNC[format=md-table]: cmd --> formats a JSON
array printed by cmd as a markdown table (or format=html-table).

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

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      config: { type: 'string', short: 'c' },
      check: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', short: 'n', default: false },
      marker: { type: 'string', short: 'm' },
      'end-marker': { type: 'string', short: 'e' },
      comment: { type: 'string' },
      shell: { type: 'string', short: 's' },
      command: { type: 'string', multiple: true },
      install: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
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
  const write = !values.check && !values['dry-run'];
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);

  log(`config: ${config.source ?? '(defaults)'}`);
  log(`markers: ${config.marker} … ${config.endMarker}  shell: ${config.shell}${config.commands.length ? `  commands: ${config.commands.join(', ')}` : ''}\n`);

  const report = ({ file, changed, regions }: FileResult) => {
    const path = displayPath(file, config.root);
    log(`${changed ? (write ? '✎' : '✗') : '✓'} ${path}`);
    for (const region of regions) {
      const at = `${path}:${region.directive.line + 1}`;
      switch (region.kind) {
        case 'updated':
          log(`    ${region.changed ? (write ? 'updated' : 'outdated') : 'ok'}  ${at}  ${region.directive.command}`);
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
  const regions = results.flatMap(r => r.regions);
  const failed = regions.filter(r => r.kind !== 'updated').length;
  const stale = results.filter(r => r.changed);
  const changedRegions = regions.filter(r => r.kind === 'updated' && r.changed).length;

  const summary = [
    `${results.length} file(s), ${regions.length} directive(s)`,
    `${changedRegions} region(s) ${write ? 'updated' : 'out of date'}`,
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

  return failed > 0 || (values.check && stale.length > 0) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`cmdsync: ${(err as Error).message}`);
  process.exitCode = 2;
}
