#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type UserConfig, resolveConfig } from './config.js';
import { type FileResult, displayPath, run } from './index.js';

const HELP = `\
Usage: update-codeblocks [options] [paths...]

Regenerate markdown code blocks from the output of the command in the
html comment directly above them:

  <!-- UPDATE_CODEBLOCK: echo hello -->
  \`\`\`text
  hello
  \`\`\`

Arguments:
  paths                  Markdown files or directories to process
                         (default: the config's "include" globs)

Options:
  -c, --config <file>    Config file (update-codeblocks.json or package.json)
      --check            Don't write; exit 1 if any code block is out of date
  -n, --dry-run          Don't write; report what would change
  -m, --marker <name>    Directive marker (overrides config)
  -s, --shell <bin>      Shell used to run commands (overrides config)
      --command <bin>    Allowed command binary, repeatable (overrides config)
  -q, --quiet            Only print errors
  -h, --help             Show this help
  -v, --version          Show version

Config is read from the nearest update-codeblocks.json, or the
"update-codeblocks" key of the nearest package.json.

Exit codes: 0 success, 1 failed command or stale code block (--check), 2 usage error
`;

const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

/** https://docs.github.com/actions/reference/workflow-commands-for-github-actions */
const annotate = (level: 'error' | 'warning', file: string, line: number, message: string) => {
  const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::${level} file=${escape(file)},line=${line},title=update-codeblocks::${escape(message)}`);
};

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      check: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', short: 'n', default: false },
      marker: { type: 'string', short: 'm' },
      shell: { type: 'string', short: 's' },
      command: { type: 'string', multiple: true },
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
    ...values.shell && { shell: values.shell },
    ...values.command && { commands: values.command },
  };
  const config = resolveConfig({ configPath: values.config, overrides });
  const write = !values.check && !values['dry-run'];
  const log = (...msg: unknown[]) => values.quiet || console.log(...msg);

  log(`config: ${config.source ?? '(defaults)'}`);
  log(`marker: <!-- ${config.marker}: ... -->  shell: ${config.shell}${config.commands.length ? `  commands: ${config.commands.join(', ')}` : ''}\n`);

  const report = ({ file, changed, blocks }: FileResult) => {
    const path = displayPath(file, config.root);
    log(`${changed ? (write ? '✎' : '✗') : '✓'} ${path}`);
    for (const block of blocks) {
      const at = `${path}:${block.directive.line + 1}`;
      switch (block.kind) {
        case 'updated':
          log(`    ${block.changed ? (write ? 'updated' : 'outdated') : 'ok'}  ${at}  ${block.directive.command}`);
          if (block.changed && values.check && isGithubActions) {
            annotate('error', path, block.directive.line + 1, `Code block is out of date, run \`update-codeblocks\` to regenerate it (${block.directive.command})`);
          }
          break;
        case 'failed': {
          const reason = block.result.error ?? `exited with status ${block.result.status}`;
          console.error(`    failed  ${at}  ${block.directive.command}\n            ${reason}`);
          if (block.result.output) console.error(block.result.output.trimEnd().replace(/^/gm, '            │ '));
          if (isGithubActions) annotate('error', path, block.directive.line + 1, `\`${block.directive.command}\` ${reason}`);
          break;
        }
        case 'missing-codeblock':
          console.error(`    skipped ${at}  no fenced code block follows the directive`);
          if (isGithubActions) annotate('warning', path, block.directive.line + 1, 'No fenced code block follows this directive');
          break;
      }
    }
  };

  const results = run(config, { paths: positionals, write, onFile: report });
  const blocks = results.flatMap(r => r.blocks);
  const failed = blocks.filter(b => b.kind === 'failed').length;
  const stale = results.filter(r => r.changed);
  const changedBlocks = blocks.filter(b => b.kind === 'updated' && b.changed).length;

  const summary = [
    `${results.length} file(s), ${blocks.length} directive(s)`,
    `${changedBlocks} code block(s) ${write ? 'updated' : 'out of date'}`,
    ...failed ? [`${failed} failed`] : [],
  ].join(', ');
  log(`\n${summary}`);

  if (isGithubActions && process.env.GITHUB_STEP_SUMMARY) {
    const rows = stale.map(r => `- \`${displayPath(r.file, config.root)}\``).join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### update-codeblocks\n\n${summary}\n\n${rows}\n`);
  }
  if (isGithubActions && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${stale.length > 0}\nfailed=${failed}\n`);
  }

  return failed > 0 || (values.check && stale.length > 0) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`update-codeblocks: ${(err as Error).message}`);
  process.exitCode = 2;
}
