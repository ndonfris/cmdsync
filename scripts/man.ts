#!/usr/bin/env node
/**
 * Writes man/cmdsync.1, the man page npm installs with the package (`man cmdsync`),
 * from the same option and subcommand tables the CLI and the completions use, so it
 * can't drift from them. `yarn build:man` (part of `yarn build`) regenerates it.
 *
 *   node scripts/man.ts           write man/cmdsync.1
 *   node scripts/man.ts --stdout  print it instead
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { optionsFor } from '../src/complete.ts';
import { type CliOption, type Context, OPTIONS, OPTION_CONTEXTS, SUBCOMMANDS } from '../src/options.ts';

const ROOT = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string; };

/** Text for roff: backslashes escaped, `-` as a real hyphen-minus, nothing read as a request at a line's start */
const roff = (text: string) => text.replace(/\\/g, '\\e').replace(/-/g, '\\-').replace(/^([.'])/gm, '\\&$1');
const bold = (text: string) => `\\fB${roff(text)}\\fR`;
const italic = (text: string) => `\\fI${roff(text)}\\fR`;

/** The placeholder for an option's value */
const METAVAR: Record<string, string> = { marker: 'name', 'end-marker': 'name', comment: 'delims', shell: 'bin', command: 'bin', from: 'marker', repo: 'name', group: 'name' };
const metavar = (o: CliOption) => METAVAR[o.long] ?? ({ file: 'file', dir: 'dir', command: 'bin', text: 'value', group: 'name', repo: 'name' } as const)[o.value!];

const where = (o: CliOption) => {
  const contexts = OPTION_CONTEXTS[o.long] ?? [];
  const named = contexts.filter(Boolean);
  if (contexts.length === 1 && contexts[0] === '') return 'Only without a subcommand.';
  if (named.length && !contexts.includes('')) return `Only with ${named.join(', ')}.`;
  return '';
};

const option = (o: CliOption, withWhere = true) => {
  const names = [...o.short ? [bold(`-${o.short}`)] : [], bold(`--${o.long}`)].join(', ');
  const value = o.value ? ` ${italic(metavar(o))}` : '';
  const negation = o.negatable ? `, ${bold(`--no-${o.long}`)}` : '';
  const note = withWhere ? where(o) : '';
  return ['.TP', `${names}${value}${negation}`, roff(`${o.description}${o.multiple && !/repeatable/.test(o.description) ? ', repeatable' : ''}.${note ? ` ${note}` : ''}`)].join('\n');
};

const section = (title: string, ...body: string[]) => [`.SH ${title}`, ...body].join('\n');
const paragraph = (text: string) => ['.PP', roff(text)].join('\n');
const example = (lines: string[]) => ['.PP', '.EX', ...lines.map(roff), '.EE'].join('\n');
const item = (term: string, text: string) => ['.TP', term, roff(text)].join('\n');

const subcommandOptions = (name: string) => {
  const options = optionsFor(name as Context);
  return name === 'init' || name === 'repos' || name === 'migrate' ? options : [];
};

export function manPage(): string {
  return [
    `.TH CMDSYNC 1 "" "cmdsync ${version}" "User Commands"`,
    section('NAME', `cmdsync \\- keep comment\\-delimited regions of files in sync with command output`),
    section('SYNOPSIS',
      ...[
        '[update] [options] [paths...]',
        'status | check | lint [options] [paths...]',
        'init [--package-json] | init global [--add]',
        'repos [list | add [path] | remove name]',
        'migrate [--from marker...] [--dry-run | --diff]',
        'completions bash|zsh|fish|nu',
        'hook install',
      ].flatMap(line => ['.br', `${bold('cmdsync')} ${roff(line)}`]).slice(1),
    ),
    section('DESCRIPTION',
      paragraph('cmdsync replaces the content of comment-delimited regions in any file (markdown and mdx code blocks and tables, html, changelogs, scripts, configs) with the output of the command named in the start comment, so generated docs never go stale.'),
      example([
        '<!-- CMDSYNC start: my-cli --version -->',
        'this line is replaced with the output of `my-cli --version`',
        '<!-- CMDSYNC end -->',
      ]),
      paragraph('Running cmdsync runs every directive and rewrites its region. A command that fails, or a directive that is invalid, leaves its region as it was and makes cmdsync exit 1. Re-running with the same output changes nothing.'),
    ),
    section('DIRECTIVES',
      paragraph('<!-- CMDSYNC [mode] [start] [key=value...]: command -->, in the comment syntax of the file (# for shell and yaml, // for javascript, {/* */} for mdx, ...). The mode says what the output replaces:'),
      item(bold('start'), 'Short for region start: every line up to the end comment, <!-- CMDSYNC end -->. With the end comment on the same line, the text between them (inline).'),
      item(bold('line'), 'The next line; the output must be one line.'),
      item(bold('codeblock'), 'The body of the fenced code block that follows (markdown). lang=fish sets its language, creating the block if there is none.'),
      item(bold('console'), 'The next fenced code block, as $ command and its output.'),
      item(bold('console-pretty'), 'The next two fenced code blocks: the command (lang=, default sh), then its output (txt).'),
      paragraph('Without a mode it is inferred: codeblock when a fenced block follows in markdown, inline when the end comment is on the same line, else a region.'),
      item(bold('format=md-table|html-table'), 'Render a JSON array printed by the command as a table.'),
      item(bold('include=path[#L10-L20]'), 'Take the content from a file (relative to the file with the directive) instead of a command; a line range is dedented.'),
      item(`${bold('lang=')}${italic('lang')}`, 'The language of the code block (codeblock and console modes).'),
      paragraph('Custom directives from the config\'s "directives" are used like a mode, and take any key=value word for their template or formatter.'),
    ),
    section('COMMANDS',
      ...SUBCOMMANDS.map(s => item(bold(s.name), `${s.description}.`)),
    ),
    section('OPTIONS',
      ...OPTIONS.map(o => option(o)),
    ),
    ...['init', 'repos', 'migrate'].map(name => section(`${name.toUpperCase()} OPTIONS`, ...subcommandOptions(name).map(o => option(o, false)))),
    section('CONFIGURATION',
      paragraph('The config is read from the nearest cmdsync.json, or the "cmdsync" key of the nearest package.json, searching up from the current directory (or from --config). Its keys include marker, endMarker, shell, commands, install, include, exclude, syntax, cwd, timeout, env, postUpdate and directives; see the JSON schema shipped as cmdsync.schema.json.'),
      paragraph('The global config holds "defaults", merged under every repository\'s own config, and the "repos" that --all, --group and --repo run in. cmdsync --show --resolved prints the merged config, with where each setting came from.'),
    ),
    section('ENVIRONMENT',
      item(bold('CMDSYNC_GLOBAL_CONFIG'), 'Path of the global config.'),
      item(bold('XDG_CONFIG_HOME'), 'The global config is $XDG_CONFIG_HOME/cmdsync/config.json (default ~/.config/cmdsync/config.json).'),
      item(bold('CMDSYNC_SHELL'), 'The shell to run commands with, when "shell" is "auto" (the default): otherwise the shell cmdsync was started from, found by walking up the parent processes, then $SHELL, then sh.'),
      item(`${bold('VISUAL')}, ${bold('EDITOR')}`, 'The editor for --edit (default vi).'),
      item(bold('NO_COLOR'), 'Turn off colored output.'),
    ),
    section('FILES',
      item(italic('cmdsync.json'), 'The project config.'),
      item(italic('~/.config/cmdsync/config.json'), 'The global config.'),
    ),
    section('EXIT STATUS',
      item(bold('0'), 'Success (and, with --check or --diff, every region is up to date).'),
      item(bold('1'), 'A command failed, a directive is invalid, --check or --diff found an out of date region, or lint found an error.'),
      item(bold('2'), 'Usage or config error.'),
    ),
    section('EXAMPLES',
      example([
        'cmdsync                      # regenerate every region',
        'cmdsync status               # show what would change',
        'cmdsync check                # in CI: exit 1 if anything is out of date',
        'cmdsync -i                   # choose which changes to apply',
        'cmdsync lint                 # check every directive without running it',
        'cmdsync hook install         # regenerate on every commit',
        'cmdsync status --group docs  # preview several repositories',
      ]),
    ),
    section('SEE ALSO',
      paragraph('The README, with every directive, option and config key: https://github.com/ndonfris/cmdsync#readme'),
    ),
    '',
  ].join('\n');
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  if (process.argv.includes('--stdout')) process.stdout.write(manPage());
  else writeFileSync(join(ROOT, 'man', 'cmdsync.1'), manPage());
}
