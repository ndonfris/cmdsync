/**
 * What to complete at the cursor, for `cmdsync __complete <words...>`, which the shell
 * completion scripts call on every TAB. One place for the rules, so every shell agrees:
 *
 * - `cmdsync <TAB>`: the subcommands
 * - `cmdsync update <TAB>` (any word typed already), or `-<TAB>`: the options usable there,
 *   without ones already given (unless repeatable) or ones that conflict with them
 * - after an option that takes a value (`--config <TAB>`): only its values
 * - paths only for a word that looks like one (`./`, `docs/`, `~/`, `.github`)
 */
import { loadGlobalConfig, repoName } from './global.ts';
import { CONFLICTS, type CliOption, type Context, OPTIONS, OPTION_CONTEXTS, SUBCOMMANDS, SUBCOMMAND_OPTIONS } from './options.ts';

/** A word that looks like a path: it has a `/`, or starts with `.` or `~` */
export const PATH_LIKE = /^[.~]|[/]/;

export interface Candidate {
  value: string;
  description: string;
}

export interface Completion {
  values: Candidate[];
  /** Also complete these, with the shell's own completion */
  then?: 'files' | 'commands';
}

/** The options usable in a context */
export function optionsFor(context: Context): CliOption[] {
  return SUBCOMMAND_OPTIONS[context] ?? OPTIONS.filter(o => OPTION_CONTEXTS[o.long]?.includes(context));
}

const conflicts = (() => {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (map.get(a) ?? map.set(a, new Set()).get(a)!).add(b);
  for (const [a, others] of CONFLICTS) {
    for (const b of others) {
      add(a, b);
      add(b, a);
    }
  }
  for (const o of OPTIONS.filter(o => o.negatable)) {
    add(o.long, `no-${o.long}`);
    add(`no-${o.long}`, o.long);
  }
  return map;
})();

/** Group or repo names from the global config, for `--group` / `--repo` */
function globalNames(kind: 'group' | 'repo'): string[] {
  try {
    const repos = loadGlobalConfig()?.repos ?? [];
    const names = kind === 'repo' ? repos.map(repoName) : repos.flatMap(r => r.groups ?? []);
    return [...new Set(names)].sort();
  } catch {
    return [];
  }
}

function values(option: CliOption, prefix = ''): Completion {
  switch (option.value) {
    case 'file': case 'dir': return { values: [], then: 'files' };
    case 'command': return { values: [], then: 'commands' };
    case 'group': case 'repo': {
      const what = option.value === 'group' ? 'group' : 'repository';
      return { values: globalNames(option.value).map(name => ({ value: `${prefix}${name}`, description: `global config ${what}` })) };
    }
    default: return { values: [] };
  }
}

/** Positional arguments at the cursor, for a context and the positionals before it */
function positional(context: Context, before: string[], word: string): Completion {
  const nth = before.length;
  const listed = (args: [string, string][]) => ({ values: args.map(([value, description]) => ({ value, description })) });
  switch (context) {
    case 'completions': return nth === 0 ? listed([['bash', ''], ['zsh', ''], ['fish', ''], ['nu', '']]) : { values: [] };
    case 'hook': return nth === 0 ? listed([['install', 'Add cmdsync --staged to the pre-commit hook']]) : { values: [] };
    case 'init': return nth === 0 ? listed([['global', 'Create the global config']]) : { values: [] };
    case 'repos':
      if (nth === 0) return listed([['list', 'List the repositories'], ['add', 'Add a repository'], ['remove', 'Remove a repository']]);
      if (nth === 1 && before[0] === 'add') return { values: [], then: 'files' };
      if (nth === 1 && before[0] === 'remove') return { values: globalNames('repo').map(value => ({ value, description: 'global config repository' })) };
      return { values: [] };
    case 'migrate': return { values: [] };
    // the run commands and lint take files or directories
    default: return PATH_LIKE.test(word) ? { values: [], then: 'files' } : { values: [] };
  }
}

/** `words`: everything after `cmdsync`, the last being the word at the cursor (empty after a space) */
export function complete(words: string[]): Completion {
  const word = words.at(-1) ?? '';
  const before = words.slice(0, -1);
  const subcommand = SUBCOMMANDS.find(s => s.name === before[0]);
  const context = (subcommand?.name ?? '') as Context;

  if (!subcommand && before.length === 0 && !word.startsWith('-')) {
    return {
      values: SUBCOMMANDS.map(s => ({ value: s.name, description: s.description })),
      ...PATH_LIKE.test(word) && { then: 'files' as const },
    };
  }

  const options = optionsFor(context);
  const find = (name: string) => options.find(o => o.long === name || (o.negatable && `no-${o.long}` === name));
  const byShort = (letter: string) => options.find(o => o.short === letter);

  // what was typed already: options (by their spelling, `install` or `no-install`), and positionals
  const used = new Set<string>();
  const positionals: string[] = [];
  let awaiting: CliOption | undefined;
  let endOfOptions = false;
  for (const token of subcommand ? before.slice(1) : before) {
    if (awaiting) {
      awaiting = undefined;
      continue;
    }
    if (!endOfOptions && token === '--') {
      endOfOptions = true;
    } else if (!endOfOptions && token.startsWith('--')) {
      const [name, inline] = [token.slice(2).split('=')[0]!, token.includes('=')];
      const option = find(name);
      if (option) used.add(name);
      if (option?.value && !inline) awaiting = option;
    } else if (!endOfOptions && /^-[^-]/.test(token)) {
      const option = byShort(token[1]!);
      if (option) used.add(option.long);
      if (option?.value && token.length === 2) awaiting = option;
    } else {
      positionals.push(token);
    }
  }

  // an option that takes a value comes first: `--config <TAB>` is only files
  if (awaiting) return values(awaiting);
  const inline = word.match(/^--([\w-]+)=/);
  if (inline) {
    const option = find(inline[1]!);
    return option?.value ? values(option, inline[0]) : { values: [] };
  }

  const args = positional(context, positionals, word);
  const wantOptions = !endOfOptions && (word.startsWith('-') || word === '');
  if (!wantOptions || used.has('help') || used.has('version')) return args;

  // init's --add/--name/--group only go with `init global`, --package-json only without; repos' only with `repos add`
  const applicable = options.filter(o =>
    context === 'init' ? (positionals.includes('global') ? o.long !== 'package-json' : o.long === 'package-json')
      : context === 'repos' ? positionals[0] === 'add'
      : true);
  const spellings = applicable.flatMap(o => [
    { name: o.long, option: o, value: `--${o.long}`, description: o.description },
    ...o.negatable ? [{ name: `no-${o.long}`, option: o, value: `--no-${o.long}`, description: `Opposite of --${o.long}` }] : [],
  ]);
  const short = /^-[^-]$/.test(word);
  const available = spellings
    .filter(s => s.option.multiple || !used.has(s.name))
    .filter(s => ![...used].some(u => conflicts.get(u)?.has(s.name)))
    // the meta options don't take paths, and --help/--version only go alone
    .filter(s => !(['show', 'edit', 'resolved'].includes(s.name) && positionals.length > 0))
    .filter(s => !(['help', 'version'].includes(s.name) && (used.size > 0 || positionals.length > 0)))
    .flatMap(s => short && s.option.short && s.name === s.option.long
      ? [{ value: `-${s.option.short}`, description: s.description }]
      : [{ value: s.value, description: s.description }]);
  return { values: [...args.values, ...available], ...args.then && { then: args.then } };
}
