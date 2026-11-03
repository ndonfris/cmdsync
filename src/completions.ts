/** Shell completion scripts for `cmdsync`, generated from the CLI's option table */
import { type CliOption, OPTIONS, SUBCOMMANDS, type Shell } from './options.ts';

const BIN = 'cmdsync';

/** Every spelling of an option: `-c`, `--config`, plus `--no-install` for negatable ones */
const flags = (o: CliOption) => [...o.short ? [`-${o.short}`] : [], `--${o.long}`, ...o.negatable ? [`--no-${o.long}`] : []];

const single = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Files and directories are only completed for a token that looks like a path (it has a `/`,
 * or starts with `.` or `~`), so `cmdsync <TAB>` lists just the subcommands, and
 * `cmdsync ./<TAB>` (or `docs/`, `~/`, `.github`) completes paths. Options that take a
 * file (`--config`) always complete files.
 */
export const PATH_LIKE = /^[.~]|[/]/;

/** Subcommands whose argument is one of a fixed set of values; the rest take paths and options */
const VALUED = SUBCOMMANDS.filter(s => s.args.length > 0);

function bash(): string {
  const valued = (kind: CliOption['value']) => OPTIONS.filter(o => o.value === kind).flatMap(flags).join('|');
  const subcommands = VALUED.map(s => [
    `  if [[ $COMP_CWORD -eq 2 && \${COMP_WORDS[1]} == ${s.name} ]]; then`,
    `    COMPREPLY=($(compgen -W ${single(s.args.join(' '))} -- "$cur"))`,
    '    return',
    '  fi',
  ].join('\n'));
  return `\
# bash completion for ${BIN}: eval "$(${BIN} completions bash)"
_${BIN}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"
  COMPREPLY=()
  # files only for a token that looks like a path: ./, ../, ~/, docs/, .github
  local path_like=0
  [[ $cur == */* || $cur == .* || $cur == '~'* ]] && path_like=1
${subcommands.join('\n')}
  case "$prev" in
    ${valued('file')}) COMPREPLY=($(compgen -f -- "$cur")); return ;;
    ${valued('command')}) COMPREPLY=($(compgen -c -- "$cur")); return ;;
    ${valued('text')}) return ;;
  esac
  if [[ $cur == -* ]]; then
    COMPREPLY=($(compgen -W ${single(OPTIONS.flatMap(flags).join(' '))} -- "$cur"))
    return
  fi
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W ${single(SUBCOMMANDS.map(s => s.name).join(' '))} -- "$cur"))
  fi
  (( path_like )) && COMPREPLY+=($(compgen -f -- "$cur"))
}
complete -o filenames -F _${BIN} ${BIN}
`;
}

function zsh(): string {
  const escape = (s: string) => s.replace(/]/g, '\\]').replace(/'/g, `'\\''`);
  const action = (o: CliOption) =>
    o.value === 'file' ? ':file:_files' : o.value === 'command' ? ':command:_command_names -e' : o.value ? ':value: ' : '';
  const specs = OPTIONS.flatMap(o => {
    const names = flags(o).filter(f => f !== `--no-${o.long}`);
    const exclusive = names.length > 1 && !o.multiple ? `(${names.join(' ')})` : '';
    const repeat = o.multiple ? '*' : '';
    const spec = names.length > 1 && !o.multiple
      ? `'${exclusive}'{${names.join(',')}}'[${escape(o.description)}]${action(o)}'`
      : names.map(n => `'${repeat}${n}[${escape(o.description)}]${action(o)}'`).join(' \\\n    ');
    return [spec, ...o.negatable ? [`'--no-${o.long}[${escape(`Opposite of --${o.long}`)}]'`] : []];
  });
  const subcommandCases = VALUED.map(s => `    ${s.name}) (( CURRENT == 3 )) && _values ${single(s.name)} ${s.args.join(' ')}; return ;;`);
  return `\
#compdef ${BIN}
# zsh completion for ${BIN}: save as _${BIN} in your $fpath, or eval "$(${BIN} completions zsh)"
_${BIN}() {
  local -a subcommands=(${SUBCOMMANDS.map(s => single(`${s.name}:${s.description}`)).join(' ')})
  case $words[2] in
${subcommandCases.join('\n')}
  esac
  local state
  _arguments -s \\
    ${specs.join(' \\\n    ')} \\
    '1: :->first' \\
    '*: :->path'
  # files only for a token that looks like a path: ./, ../, ~/, docs/, .github
  local path_like=0
  [[ $PREFIX == */* || $PREFIX == .* || $PREFIX == '~'* ]] && path_like=1
  case $state in
    first)
      _describe -t commands 'subcommand' subcommands
      (( path_like )) && _files
      ;;
    path) (( path_like )) && _files ;;
  esac
}
if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _${BIN} "$@"
else
  compdef _${BIN} ${BIN}
fi
`;
}

function fish(): string {
  const lines = [
    `# fish completion for ${BIN}: ${BIN} completions fish > ~/.config/fish/completions/${BIN}.fish`,
    '',
    '# files only for a token that looks like a path: ./, ../, ~/, docs/, .github',
    `function __${BIN}_path_like`,
    `    string match -qr -- ${single(PATH_LIKE.source)} (commandline -ct)`,
    'end',
    `complete -c ${BIN} -f`,
    `complete -c ${BIN} -n __${BIN}_path_like -F`,
    '',
    ...SUBCOMMANDS.flatMap(s => [
      `complete -c ${BIN} -n __fish_use_subcommand -a ${s.name} -d ${single(s.description)}`,
      ...s.args.length ? [`complete -c ${BIN} -n '__fish_seen_subcommand_from ${s.name}' -a ${single(s.args.join(' '))}`] : [],
    ]),
    ...OPTIONS.flatMap(o => {
      const names = `${o.short ? `-s ${o.short} ` : ''}-l ${o.long}`;
      const value = o.value === 'file' ? ' -r -F' : o.value === 'command' ? " -x -a '(__fish_complete_command)'" : o.value ? ' -x' : '';
      return [
        `complete -c ${BIN} ${names}${value} -d ${single(o.description)}`,
        ...o.negatable ? [`complete -c ${BIN} -l no-${o.long} -d ${single(`Opposite of --${o.long}`)}`] : [],
      ];
    }),
  ];
  return `${lines.join('\n')}\n`;
}

function nu(): string {
  const type = (o: CliOption) => o.value === 'file' ? ': path' : o.value ? ': string' : '';
  const flag = (o: CliOption) => `--${o.long}${o.short ? `(-${o.short})` : ''}${type(o)}`;
  const width = Math.max(...OPTIONS.map(o => flag(o).length));
  const options = OPTIONS.flatMap(o => [
    `  ${flag(o).padEnd(width)}  # ${o.description}`,
    ...o.negatable ? [`  ${`--no-${o.long}`.padEnd(width)}  # Opposite of --${o.long}`] : [],
  ]);
  const paths = `  ${`...paths: string@"nu-complete ${BIN} paths"`.padEnd(width)}  # Files or directories to process`;
  const subcommands = SUBCOMMANDS.flatMap(s => s.args.length ? [
    '',
    `def "nu-complete ${BIN} ${s.name}" [] { [${s.args.map(a => `"${a}"`).join(' ')}] }`,
    '',
    `# ${s.description}`,
    `export extern "${BIN} ${s.name}" [`,
    `  arg: string@"nu-complete ${BIN} ${s.name}"`,
    ']',
  ] : [
    '',
    `# ${s.description}`,
    `export extern "${BIN} ${s.name}" [`,
    paths,
    ...options,
    ']',
  ]);
  return `\
# nushell completion for ${BIN}:
#   ${BIN} completions nu | save -f ($nu.default-config-dir | path join completions ${BIN}.nu)
#   then add \`use completions/${BIN}.nu *\` to your config.nu

# files only for a token that looks like a path (./, ../, ~/, docs/, .github):
# null falls back to nushell's file completion, an empty list completes nothing
def "nu-complete ${BIN} paths" [context: string] {
  let token = ($context | split row ' ' | last)
  if ($token =~ ${JSON.stringify(PATH_LIKE.source)}) { null } else { [] }
}

export extern "${BIN}" [
${paths}
${options.join('\n')}
]
${subcommands.join('\n')}
`;
}

export function completionScript(shell: Shell): string {
  switch (shell) {
    case 'bash': return bash();
    case 'zsh': return zsh();
    case 'fish': return fish();
    case 'nu': return nu();
  }
}
