# CLI

<!-- CMDSYNC codeblock: node src/cli.ts --help -->
```text
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
  this line is replaced with the output of `my-cli --version`
  <!-- CMDSYNC end -->

In markdown, `<!-- CMDSYNC codeblock: cmd -->` followed by a fenced code
block replaces just the body of that block, and no end comment is needed.

Arguments:
  paths                    Files or directories to process
                           (default: the config's "include" globs)

Commands:
  update [paths...]        Regenerate every directive, write the files, then run
                           the config's "postUpdate" commands (the default)
  status [paths...]        Print a diff of what `update` would change, without
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
  hook install             Add `cmdsync --staged` to the git pre-commit hook
                           (prints the line to add if a hook already exists)

Options:
  -c, --config <file>      Config file (cmdsync.json or package.json)
      --show               Print the config (--config, or the nearest one) and
                           exit; for package.json, its "cmdsync" key
      --edit               Open the config in $VISUAL / $EDITOR / vi, and check
                           it when the editor exits
      --resolved           With --show (or alone): print the config a run would
                           use, merged from the defaults, the global config, the
                           config file and flags, marking where each value is from
      --check              Don't write; exit 1 if any region is out of date
  -n, --dry-run            Don't write; report what would change
  -i, --interactive        Show each change and ask whether to apply it
                           (y/n, a/d: all or none left in the file, q: quit)
  -d, --diff               Don't write; print a unified diff of what would
                           change, and exit 1 if anything is out of date
      --staged             Write, then `git add` the files that changed; refuses
                           files with unstaged changes (for a pre-commit hook)
  -m, --marker <name>      Start marker (overrides config)
  -e, --end-marker <name>  End marker (overrides config, default: "<marker> end")
      --comment <delims>   Comment delimiters for every file, e.g. '#' or '/* */'
                           (overrides config and the built-in syntax table)
  -s, --shell <bin>        Shell used to run commands (overrides config); `auto`
                           (the default): the shell cmdsync was started from
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
             (`start` is short for `region start`; on one line: inline)
  line       replace the next line (output must be one line)
  codeblock  replace the body of the next fenced code block (markdown)
             (lang=fish sets its language, creating the block if missing)
  console    the next fenced code block, as `$ cmd` and its output
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
```

| Exit code | Meaning |
| --- | --- |
| `0` | Everything succeeded (and, with `--check` or `--diff`, every region is up to date) |
| `1` | A command failed, a directive is invalid (unterminated region, unknown option), `--check`/`--diff` found an out of date region, or `lint` found an error |
| `2` | Usage or config error |

Typical `package.json` scripts:

```json
{
  "scripts": {
    "docs": "cmdsync",
    "docs:check": "cmdsync --check"
  }
}
```

## Seeing what would change

`cmdsync status` prints a diff of what `cmdsync update` would change, without writing, and exits 0 (unless a directive fails). `cmdsync check` is `--check`, for CI.

`--diff` doesn't write anything either: it prints a unified diff of every file that's out of date, and exits 1 if there are any, so it's `--check` with the details. It's colored in a terminal (unless `NO_COLOR` is set), and plain when piped, so `cmdsync --diff > docs.patch` gives a patch you can `git apply`.

```diff
--- a/README.md
+++ b/README.md
@@ -8,3 +8,3 @@
 <!-- CMDSYNC start: my-cli --version -->
-1.2.3
+1.3.0
 <!-- CMDSYNC end -->
```

## Choosing which changes to apply

`cmdsync -i` (`--interactive`, also `cmdsync update -i`) regenerates everything, then shows each change as a diff, like `git add -p`, and asks before writing it:

````text
README.md:12  my-cli --help  (1/2)
@@ -11,4 +11,4 @@
 <!-- CMDSYNC codeblock: my-cli --help -->
 ```text
-Usage: my-cli [options]
+Usage: my-cli [options] <file>
 ```
Apply this change [y,n,a,d,q,?]?
````

| Key | Does |
| --- | --- |
| `y` / `n` | apply / skip this change |
| `a` / `d` | apply / skip this change and every later one in the file |
| `q` | skip this change and everything after it, then write what was accepted |
| `?` | help |

Only files with an accepted change are written, and [`postUpdate`](configuration.md#post-update-commands) commands get just those. Each run of changed lines is one change, so two regions next to each other are still asked about separately. Answers are read a line at a time from stdin, so they can be piped (`printf 'y\nn\n' | cmdsync -i`); the end of input counts as `q`. It can't be combined with `check`, `status`, `--dry-run`, `--diff` or `--staged`, which never write or don't ask.

## Linting directives

`cmdsync lint [paths...]` checks every directive without running a command or writing a file, and lists where each one is, with the line range it covers and the mode it resolved to:

```text
✗ docs/guide.md
    ok       docs/guide.md:4-9  region     my-cli --help
    ok       docs/guide.md:12-16  codeblock  include=../src/example.ts#L10-L20
    warning docs/guide.md:12  my-cli: not on PATH, and no "install" command for it
    invalid  docs/guide.md:20             echo hi
            unknown mode "strat" (expected region, line, codeblock)
    failed   docs/guide.md:24  region     include=missing.md
            include missing.md: no such file
    stray    docs/guide.md:30  <!-- CMDSYNC end -->
            mentions CMDSYNC, but isn't a directive or an end marker that closes one

1 file(s), 4 directive(s), 3 error(s), 1 warning(s)
```

Errors (exit 1):

- **invalid**: an unknown mode or option, a missing end marker or code block, `start` on a `line` directive, ...
- **failed**: a command outside the [`commands`](configuration.md#recognized-commands) allowlist, or an `include=` file or line range that doesn't exist
- **stray**: a comment that mentions the marker but isn't a directive or an end marker that closes one, like a leftover `<!-- CMDSYNC end -->` or a typo such as `<!-- CMDSYNC strat: cmd -->` (examples in inline code or fenced code blocks don't count)

Warnings: a command's binary isn't on `PATH`, and there's no [`install`](configuration.md#installing-binaries) command for it.

It's quick and has no side effects, so it suits an editor task or the first step of CI, before the commands' tools are installed.

## Shell completions

`cmdsync completions <shell>` prints a completion script for `bash`, `zsh`, `fish` or `nu`. The scripts are generated from the same option table the CLI parses, so they always match the installed version. POSIX `sh` has no completion system, so it isn't supported.

Completions follow what the CLI accepts at the cursor:

- `cmdsync <TAB>` lists the subcommands, with their descriptions where the shell shows them.
- `cmdsync update <TAB>` (any subcommand, or after any option), or `-<TAB>`, lists the options usable there: `update` doesn't offer `--check`, `lint` doesn't offer `--install`, `migrate` lists its own. Options already given are left out (unless they can repeat), and so are the ones that can't go with them: after `--staged` there's no `--check`, `--dry-run`, `--diff`, `--interactive` or `--all`, after `-q` no `--verbose`, after `--install` no `--no-install`.
- An option that takes a value completes only that value: `--config <TAB>` lists files, `--shell <TAB>` commands, `--repo`/`--group <TAB>` the [global config](configuration.md#multiple-repositories)'s names; the other options come back once the value is there.
- Paths are offered once the word being completed looks like one: it has a `/`, or starts with `.` or `~` (`cmdsync ./<TAB>`, `cmdsync docs/<TAB>`).

The scripts get all of this from `cmdsync __complete <words...>`, so the rules are the same in every shell, and always match the installed version. (In nushell, which checks options against a command's signature, typing `-` lists every option of that subcommand; `<TAB>` after a word uses the filtered list.)

```fish
# bash: in ~/.bashrc
eval "$(cmdsync completions bash)"

# zsh: in ~/.zshrc (after compinit), or save it as _cmdsync somewhere in $fpath
eval "$(cmdsync completions zsh)"

# fish
cmdsync completions fish > ~/.config/fish/completions/cmdsync.fish

# nushell: save the module, then add `use completions/cmdsync.nu *` to config.nu
cmdsync completions nu | save -f ($nu.default-config-dir | path join completions cmdsync.nu)
```

A path literally named `completions` must be written as `./completions`.

## Man page

The same reference, as a man page: [`man/cmdsync.1`](../man/cmdsync.1). It's generated from the CLI's option and subcommand tables (`yarn build:man`, part of every build), so it lists exactly the options this version has.

```fish
man cmdsync                       # after a global npm install
man ./man/cmdsync.1               # from a checkout, without installing (man -l on some systems)
```

If `man cmdsync` finds nothing after `npm install -g cmdsync`, see [the man page](global-install.md#the-man-page) in the global install guide.

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/cli.md -->
---

[← Custom directives](custom-directives.md) · [Contents](README.md) · [Configuration →](configuration.md)
<!-- CMDSYNC end -->
