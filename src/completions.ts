/**
 * Shell completion scripts for `cmdsync`. They ask the CLI what to complete, with
 * `cmdsync __complete <words...>` (see complete.ts), so every shell gets the same rules:
 * a line saying what else the shell should complete (`files`, `commands` or `none`), then
 * one `value<TAB>description` line per candidate.
 */
import { optionsFor } from './complete.ts';
import { type CliOption, type Context, SUBCOMMANDS, type Shell } from './options.ts';

export { PATH_LIKE } from './complete.ts';

const BIN = 'cmdsync';

function bash(): string {
  return `\
# bash completion for ${BIN}: eval "$(${BIN} completions bash)"
_${BIN}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" IFS=$'\\n' line value
  local -a out
  out=($(${BIN} __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)) || return
  COMPREPLY=()
  for line in "\${out[@]:1}"; do
    value=\${line%%$'\\t'*}
    [[ $value == "$cur"* ]] && COMPREPLY+=("$value")
  done
  case \${out[0]} in
    files) COMPREPLY+=($(compgen -f -- "$cur")) ;;
    commands) COMPREPLY+=($(compgen -c -- "$cur")) ;;
  esac
}
complete -o filenames -F _${BIN} ${BIN}
`;
}

function zsh(): string {
  return `\
#compdef ${BIN}
# zsh completion for ${BIN}: save as _${BIN} in your $fpath, or eval "$(${BIN} completions zsh)"
_${BIN}() {
  local -a lines candidates
  local line
  lines=("\${(@f)$(${BIN} __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  for line in "\${(@)lines[2,-1]}"; do
    [[ -n $line ]] && candidates+=("\${\${line%%$'\\t'*}//:/\\\\:}:\${line#*$'\\t'}")
  done
  (( \${#candidates} )) && _describe -t values '${BIN}' candidates
  case $lines[1] in
    files) _files ;;
    commands) _command_names -e ;;
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
  return `\
# fish completion for ${BIN}: ${BIN} completions fish > ~/.config/fish/completions/${BIN}.fish
function __${BIN}_complete
    set -l out (${BIN} __complete (commandline -opc)[2..] (commandline -ct) 2>/dev/null)
    or return
    printf '%s\\n' $out[2..]
    switch "$out[1]"
        case files
            __fish_complete_path (commandline -ct)
        case commands
            __fish_complete_command
    end
end
complete -c ${BIN} -f -a '(__${BIN}_complete)'
`;
}

/**
 * nushell checks flags against an extern's signature, so each subcommand gets one with
 * only its options; their arguments (and the options at `cmdsync update <TAB>`, filtered
 * like the other shells) come from the same `__complete`.
 */
function nu(): string {
  const type = (o: CliOption) => o.value === 'file' || o.value === 'dir' ? ': path'
    : o.value === 'group' || o.value === 'repo' ? `: string@"nu-complete ${BIN}"`
    : o.value ? ': string' : '';
  const flag = (o: CliOption) => `--${o.long}${o.short ? `(-${o.short})` : ''}${type(o)}`;
  const extern = (name: string, context: Context, description: string) => {
    const options = optionsFor(context);
    const lines = [
      `...args: string@"nu-complete ${BIN}"`,
      ...options.flatMap(o => [flag(o), ...o.negatable ? [`--no-${o.long}`] : []]),
    ];
    const descriptions = ['Arguments', ...options.flatMap(o => [o.description, ...o.negatable ? [`Opposite of --${o.long}`] : []])];
    const width = Math.max(...lines.map(l => l.length));
    return [
      '',
      `# ${description}`,
      `export extern "${name}" [`,
      ...lines.map((l, i) => `  ${l.padEnd(width)}  # ${descriptions[i]}`),
      ']',
    ].join('\n');
  };
  return `\
# nushell completion for ${BIN}:
#   ${BIN} completions nu | save -f ($nu.default-config-dir | path join completions ${BIN}.nu)
#   then add \`use completions/${BIN}.nu *\` to your config.nu

# what to complete, from \`${BIN} __complete\`; null falls back to nushell's file completion.
# \`buffer\` is the command line: newer nushell binds it by name, older ones pass it first
def "nu-complete ${BIN}" [buffer: string] {
  let words = ($buffer | split row ' ' | skip 1)
  let out = (^${BIN} __complete ...$words | lines)
  let candidates = ($out | skip 1 | each {|line|
    let parts = ($line | split row "\\t")
    { value: $parts.0, description: (if ($parts | length) > 1 { $parts.1 } else { '' }) }
  })
  if ($out | first) == 'files' and ($candidates | is-empty) { null } else { $candidates }
}
${extern(BIN, '', 'Keep comment-delimited regions of files in sync with command output')}
${SUBCOMMANDS.map(s => extern(`${BIN} ${s.name}`, s.name as Context, s.description)).join('\n')}
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
