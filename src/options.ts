/** CLI options and subcommands, shared by argument parsing and the completion scripts */

export interface CliOption {
  long: string;
  short?: string;
  /** What the option's value completes to; boolean flags have none */
  value?: 'file' | 'command' | 'text';
  multiple?: boolean;
  /** Also accepts `--no-<long>` */
  negatable?: boolean;
  description: string;
}

export const OPTIONS: CliOption[] = [
  { long: 'config', short: 'c', value: 'file', description: 'Config file (cmdsync.json or package.json)' },
  { long: 'check', description: "Don't write; exit 1 if any region is out of date" },
  { long: 'dry-run', short: 'n', description: "Don't write; report what would change" },
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
  { long: 'group', short: 'g', value: 'text', multiple: true, description: 'Run in the global config repositories of a group, repeatable' },
  { long: 'repo', short: 'r', value: 'text', multiple: true, description: 'Run in a global config repository, by name or path, repeatable' },
  { long: 'quiet', short: 'q', description: 'Only print errors' },
  { long: 'verbose', description: 'Also print every file scanned and every command run, with timings' },
  { long: 'help', short: 'h', description: 'Show help' },
  { long: 'version', short: 'v', description: 'Show version' },
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
  { name: 'lint', description: 'Check every directive without running commands, and list where each one is', args: [] },
];

/** `parseArgs` options; kept literal so parsed values stay typed, and tested against `OPTIONS` */
export const PARSE_OPTIONS = {
  config: { type: 'string', short: 'c' },
  check: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', short: 'n', default: false },
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
