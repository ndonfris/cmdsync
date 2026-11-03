# Getting started

## 1. Install

- [Local install](local-install.md): a dev dependency of the project, so everyone runs the same version. The usual choice.
- [Global install](global-install.md): `cmdsync` on your `PATH` in every repository.
- [Building from source](development.md#building-from-source): your own checkout, linked as `cmdsync`.

## 2. Create a config

```fish
cmdsync init                  # writes a starter cmdsync.json
cmdsync init --package-json   # or a "cmdsync" key in package.json
```

`init` leaves an existing config alone. The config is optional (cmdsync scans markdown and mdx files by default), but it's where you allow commands, add file types and set the shell: see [configuration](configuration.md).

Coming from `update-codeblocks`? `cmdsync migrate` converts its config and directives instead (`cmdsync migrate --diff` shows the changes first). See [migrating](migrating.md).

## 3. Add a directive

Put a comment naming a command next to the content it produces, in any file with comments:

````markdown
<!-- CMDSYNC start: my-cli --version -->
<!-- CMDSYNC end -->
````

See [directives](directives.md) for the other modes (a single line, a code block, a command with its output, tables, included files).

## 4. Run it

```fish
cmdsync status   # show what would change
cmdsync          # regenerate every directive
cmdsync check    # in CI: exit 1 if anything is out of date
cmdsync lint     # check every directive without running anything
```

## 5. Shell completions

```fish
cmdsync completions fish > ~/.config/fish/completions/cmdsync.fish
```

bash, zsh and nushell work too: see [shell completions](cli.md#shell-completions).

## Next

- [Git hooks](git-hooks.md): regenerate on every commit
- [GitHub Actions](github-actions.md): check (or regenerate) in CI
- [The CLI](cli.md): every command and option

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/getting-started.md -->
---

[Contents](README.md) · [Local install →](local-install.md)
<!-- CMDSYNC end -->
