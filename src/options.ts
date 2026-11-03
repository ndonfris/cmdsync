/** CLI options and subcommands, shared by argument parsing and the completion scripts */

/** Where an option can be used: `''` is `cmdsync` with no subcommand */
export type Context = '' | 'update' | 'status' | 'check' | 'lint' | 'init' | 'repos' | 'migrate' | 'completions' | 'hook';

export interface CliOption {
  long: string;
  short?: string;
  /**
   * What the option's value completes to (boolean flags have none): files, directories,
   * executables, nothing (`text`), or the global config's group or repo names
   */
  value?: 'file' | 'dir' | 'command' | 'text' | 'group' | 'repo';
  multiple?: boolean;
  /** Also accepts `--no-<long>` */
  negatable?: boolean;
  description: string;
}

export const OPTIONS: CliOption[] = [
  { long: 'config', short: 'c', value: 'file', description: 'Config file (cmdsync.json or package.json)' },
  { long: 'show', description: 'Print the config (--config, or the nearest one) and exit' },
  { long: 'resolved', description: 'Print the merged config, with where each setting comes from' },
  { long: 'edit', description: 'Open the config in $VISUAL / $EDITOR, and check it afterwards' },
  { long: 'check', description: "Don't write; exit 1 if any region is out of date" },
  { long: 'dry-run', short: 'n', description: "Don't write; report what would change" },
  { long: 'interactive', short: 'i', description: 'Show each change and ask whether to apply it' },
  { long: 'diff', short: 'd', description: "Don't write; print a diff of what would change, exit 1 if any" },
  { long: 'staged', description: 'Write, then git add the changed files (for a pre-commit hook)' },
  { long: 'marker', short: 'm', value: 'text', description: 'Start marker (overrides config)' },
  { long: 'end-marker', short: 'e', value: 'text', description: 'End marker (overrides config, default: <marker> end)' },
  { long: 'comment', value: 'text', description: "Comment delimiters for every file, e.g. '#' or '/* */'" },
  { long: 'shell', short: 's', value: 'command', description: 'Shell used to run commands (overrides config)' },
  { long: 'command', value: 'command', multiple: true, description: 'Allowed command binary, repeatable (overrides config)' },
  { long: 'install', negatable: true, description: 'Install every binary a directive uses (--no-install: never install)' },
  { long: 'post-update-cmds', negatable: true, description: 'Run the postUpdate commands even if nothing changed (--no-post-update-cmds: never)' },
  { long: 'all', description: 'Run in every repository of the global config' },
  { long: 'group', short: 'g', value: 'group', multiple: true, description: 'Run in the global config repositories of a group, repeatable' },
  { long: 'repo', short: 'r', value: 'repo', multiple: true, description: 'Run in a global config repository, by name or path, repeatable' },
  { long: 'quiet', short: 'q', description: 'Only print errors' },
  { long: 'verbose', description: 'Also print every file scanned and every command run, with timings' },
  { long: 'help', short: 'h', description: 'Show help' },
  { long: 'version', short: 'v', description: 'Show version' },
];

/** The run commands: plain `cmdsync`, and `update`, `status`, `check` */
const RUN: Context[] = ['', 'update', 'status', 'check'];

/**
 * Where each option of `OPTIONS` is accepted, mirroring the CLI's checks (`update` takes no
 * --check/--dry-run/--diff, `lint` runs and writes nothing, ...); used by the completions.
 */
export const OPTION_CONTEXTS: Record<string, Context[]> = {
  config: [...RUN, 'lint'],
  show: [''],
  resolved: [''],
  edit: [''],
  check: [''],
  'dry-run': [''],
  interactive: ['', 'update'],
  diff: ['', 'check'],
  staged: ['', 'update'],
  marker: [...RUN, 'lint'],
  'end-marker': [...RUN, 'lint'],
  comment: [...RUN, 'lint'],
  shell: [...RUN, 'lint'],
  command: [...RUN, 'lint'],
  install: RUN,
  'post-update-cmds': ['', 'update'],
  all: [...RUN, 'lint'],
  group: [...RUN, 'lint'],
  repo: [...RUN, 'lint'],
  quiet: [...RUN, 'lint'],
  verbose: [...RUN, 'lint'],
  help: [''],
  version: [''],
};

/** Options of the subcommands that parse their own (`init`, `repos`, `migrate`) */
export const SUBCOMMAND_OPTIONS: Partial<Record<Context, CliOption[]>> = {
  init: [
    { long: 'package-json', description: 'Write a "cmdsync" key in package.json instead of cmdsync.json' },
    { long: 'add', description: 'init global: also add this repository' },
    { long: 'name', value: 'text', description: 'init global --add: the repository\'s name' },
    { long: 'group', value: 'group', multiple: true, description: 'init global --add: a group for the repository, repeatable' },
  ],
  repos: [
    { long: 'name', value: 'text', description: 'repos add: the repository\'s name' },
    { long: 'group', value: 'group', multiple: true, description: 'repos add: a group for the repository, repeatable' },
  ],
  migrate: [
    { long: 'dry-run', short: 'n', description: 'Only list what would change' },
    { long: 'diff', short: 'd', description: 'Show the changes, without writing' },
    { long: 'quiet', short: 'q', description: 'Only print errors' },
    { long: 'from', short: 'f', value: 'text', multiple: true, description: 'Also convert directives of this marker, repeatable' },
  ],
};

/**
 * Options that can't be used together (each also excludes its `--no-` form), as the
 * CLI rejects them; spelled without dashes. Symmetric: listing a pair once is enough.
 */
export const CONFLICTS: [string, string[]][] = [
  ['staged', ['check', 'dry-run', 'diff', 'interactive', 'all', 'group', 'repo']],
  ['interactive', ['check', 'dry-run', 'diff']],
  ['post-update-cmds', ['check', 'dry-run', 'diff']],
  ['quiet', ['verbose']],
  ['config', ['all', 'group', 'repo']],
  ...['show', 'edit', 'resolved'].map((meta): [string, string[]] =>
    [meta, ['check', 'dry-run', 'diff', 'staged', 'interactive', 'install', 'no-install', 'post-update-cmds', 'no-post-update-cmds', 'all', 'group', 'repo', 'verbose']]),
];

export interface Subcommand {
  name: string;
  description: string;
  /** Values the first argument completes to; paths and options when empty */
  args: string[];
}

export const SHELLS = ['bash', 'zsh', 'fish', 'nu'] as const;
export type Shell = typeof SHELLS[number];

export const SUBCOMMANDS: Subcommand[] = [
  { name: 'update', description: 'Regenerate every directive and write the files (the default)', args: [] },
  { name: 'status', description: "Show a diff of what update would change, without writing", args: [] },
  { name: 'check', description: 'Exit 1 if any region is out of date (same as --check)', args: [] },
  { name: 'completions', description: 'Print a shell completion script', args: [...SHELLS] },
  { name: 'hook', description: 'Add cmdsync --staged to the git pre-commit hook', args: ['install'] },
  { name: 'init', description: 'Create a cmdsync.json here, or the global config (init global)', args: ['global'] },
  { name: 'repos', description: 'List, add or remove repositories in the global config', args: ['list', 'add', 'remove'] },
  { name: 'migrate', description: 'Convert update-codeblocks and older cmdsync syntax to the current one', args: [] },
  { name: 'lint', description: 'Check every directive without running commands, and list where each one is', args: [] },
];

/** `parseArgs` options; kept literal so parsed values stay typed, and tested against `OPTIONS` */
export const PARSE_OPTIONS = {
  config: { type: 'string', short: 'c' },
  show: { type: 'boolean', default: false },
  edit: { type: 'boolean', default: false },
  resolved: { type: 'boolean', default: false },
  check: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', short: 'n', default: false },
  interactive: { type: 'boolean', short: 'i', default: false },
  diff: { type: 'boolean', short: 'd', default: false },
  staged: { type: 'boolean', default: false },
  marker: { type: 'string', short: 'm' },
  'end-marker': { type: 'string', short: 'e' },
  comment: { type: 'string' },
  shell: { type: 'string', short: 's' },
  command: { type: 'string', multiple: true },
  install: { type: 'boolean' },
  'post-update-cmds': { type: 'boolean' },
  all: { type: 'boolean', default: false },
  group: { type: 'string', short: 'g', multiple: true },
  repo: { type: 'string', short: 'r', multiple: true },
  quiet: { type: 'boolean', short: 'q', default: false },
  verbose: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
} as const;
