# cmdsync documentation

Start with [Directives](directives.md), then read whichever guide you need. Each one ends with links to the previous and next guide.

<!-- CMDSYNC start: node scripts/docs-nav.ts --toc -->
1. **[Directives](directives.md)**: The directive syntax and modes (region, line, codeblock, console, inline), `include=`, tables, mdx, changelogs, any file, and the comment syntax per file type
   - [region](directives.md#region)
   - [line](directives.md#line)
   - [codeblock](directives.md#codeblock)
   - [console](directives.md#console)
   - [inline](directives.md#inline)
   - [Including files](directives.md#including-files)
   - [Tables](directives.md#tables)
   - [MDX](directives.md#mdx)
   - [Changelogs](directives.md#changelogs)
   - [Any other file](directives.md#any-other-file)
   - [Comment syntax](directives.md#comment-syntax)
2. **[Custom directives](custom-directives.md)**: Your own directives: templates, filters and TypeScript formatters
   - [Templates](custom-directives.md#templates)
   - [Formatters](custom-directives.md#formatters)
3. **[CLI](cli.md)**: Every command and option, `status`/`--diff`, interactive mode, `lint`, shell completions, the man page
   - [Seeing what would change](cli.md#seeing-what-would-change)
   - [Choosing which changes to apply](cli.md#choosing-which-changes-to-apply)
   - [Linting directives](cli.md#linting-directives)
   - [Shell completions](cli.md#shell-completions)
4. **[Configuration](configuration.md)**: `cmdsync.json` / `package.json`, allowed commands, installing binaries, the shell, post-update commands, the global config and multiple repositories
   - [`cmdsync.json`](configuration.md#cmdsyncjson)
   - [`package.json`](configuration.md#packagejson)
   - [Recognized commands](configuration.md#recognized-commands)
   - [Installing binaries](configuration.md#installing-binaries)
   - [The shell](configuration.md#the-shell)
   - [Post-update commands](configuration.md#post-update-commands)
   - [Multiple repositories](configuration.md#multiple-repositories)
5. **[Git hooks](git-hooks.md)**: Regenerating on every commit: `cmdsync hook install`, husky, lefthook, pre-commit
   - [`cmdsync hook install`](git-hooks.md#cmdsync-hook-install)
   - [Hook managers](git-hooks.md#hook-managers)
6. **[GitHub Actions](github-actions.md)**: The action, checking or regenerating in CI, and updating other repositories on release
   - [Using the action](github-actions.md#using-the-action)
   - [Regenerate and commit](github-actions.md#regenerate-and-commit)
   - [Without the action](github-actions.md#without-the-action)
   - [Updating other repositories on release](github-actions.md#updating-other-repositories-on-release)
7. **[Generating docs from your source code](generating-docs.md)**: A worked example: tables generated from TypeScript source
   - [Using it from other repositories](generating-docs.md#using-it-from-other-repositories)
8. **[Using it as a library](library.md)**: The API
9. **[Migrating from `update-codeblocks`](migrating.md)**: `cmdsync migrate`
10. **[Development](development.md)**: Building from source, tests, releasing
   - [Building from source](development.md#building-from-source)
   - [Publishing to npm](development.md#publishing-to-npm)
<!-- CMDSYNC end -->

[← Back to the README](../README.md)
