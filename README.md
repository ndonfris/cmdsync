<div align="center">

# cmdsync <br/> [![npm](https://img.shields.io/npm/v/cmdsync?logo=npm&color=a8322d)](https://www.npmjs.com/package/cmdsync) [![ci](https://img.shields.io/github/actions/workflow/status/ndonfris/cmdsync/ci.yml?branch=master&label=ci&logo=github)](https://github.com/ndonfris/cmdsync/actions/workflows/ci.yml) <!-- CMDSYNC start: node -p "'[![node](https://img.shields.io/badge/node-' + encodeURIComponent(require('./package.json').engines.node) + '-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)'" -->[![node](https://img.shields.io/badge/node-%3E%3D22.18.0-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)<!-- CMDSYNC end --> [![license](https://img.shields.io/badge/license-MIT-6f9fd8)](./LICENSE.md) [![dependencies](https://img.shields.io/badge/dependencies-0-8957e5)](./package.json) [![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](./src/index.ts)

</div>

Keep generated parts of your files (docs, tables, changelogs, version strings, config snippets) in sync with the output of real commands.

Put a comment naming a command next to the content it produces directly in your documentation:

````markdown
<!-- CMDSYNC start: my-cli --version -->
this line is replaced with the output of `my-cli --version`
<!-- CMDSYNC end -->
````

Running `cmdsync` executes each command and replaces **only the content the comment points at**. The comments stay where they are, so running it again regenerates the same content.

## Features

- **Highly customizable and configurable.** Use a local config in your project, a global config for all your repositories, or a combination of both. Specify which commands are allowed, how to install missing binaries, run post-update commands, and more [configuration](docs/configuration.md).

- **Update content inside existing files.** [Target a region, code block, line, or inline value](docs/directives.md) in `md`, `mdx`, `html`, `yaml`, or **any file** with *<ins>comments</ins>*. Surrounding content stays intact

- **Keep examples tied to their source.** Capture real command output, show a command alongside its result, or [include a file or selected lines directly](docs/directives.md#including-files).

- **Turn output into readable docs.** Render JSON as [Markdown or HTML tables](docs/directives.md#tables), or define [reusable templates and JavaScript/TypeScript formatters](docs/custom-directives.md).

- **Review changes before applying them.** Preview a diff with `cmdsync status` or approve changes individually with `cmdsync -i`. Unchanged output leaves files untouched; failed commands preserve their existing content. The [CLI](docs/cli.md) specifies lots of other useful combinations.

- **Catch stale content in your workflow.** Use `cmdsync check` in [CI](docs/configuration.md), regenerate with a [pre-commit](docs/git-hooks.md) hook, or open downstream update PRs when you release via [Github Actions](docs/github-actions.md).

<!-- ### Option 2: Capability table -->
<!---->
<!-- | Capability | Details | -->
<!-- | --- | --- | -->
<!-- | **Update content inside existing files.** | Target a region, code block, line, or inline value in md, mdx, html, yaml, source code, or any file with comments. Surrounding content stays intact ([directives](docs/directives.md)). | -->
<!-- | **Keep examples tied to their source.** | Capture real command output, show a command alongside its result, or include a file or selected lines directly ([includes](docs/directives.md#including-files)). | -->
<!-- | **Turn output into readable docs.** | Render JSON as Markdown or HTML tables, or define reusable templates and JavaScript/TypeScript formatters ([tables](docs/directives.md#tables), [custom directives](docs/custom-directives.md)). | -->
<!-- | **Review changes before applying them.** | Preview a diff with `cmdsync status` or approve changes individually with `cmdsync -i`. Unchanged output leaves files untouched; failed commands preserve their existing content ([CLI](docs/cli.md)). | -->
<!-- | **Catch stale content in your workflow.** | Use `cmdsync check` in CI, regenerate with a pre-commit hook, or open downstream update PRs when you release ([git hooks](docs/git-hooks.md), [GitHub Actions](docs/github-actions.md)). | -->
<!-- | **Highly customizable and configurable.** | Use a local config in your project, a global config for all your repositories, or a combination of both. Specify which commands are allowed, how to install missing binaries, run post-update commands, and more ([configuration](docs/configuration.md)). | -->
<!---->
<!-- ### Option 3: Grouped sections -->
<!---->
<!-- #### Sources and placement -->
<!---->
<!-- - **Update content inside existing files.** Target a region, code block, line, or inline value in md, -->
<!--   mdx, html, yaml, source code, or any file with comments. Surrounding content stays intact ([directives](docs/directives.md)). -->
<!-- - **Keep examples tied to their source.** Capture real command output, show a command alongside its -->
<!--   result, or include a file or selected lines directly ([includes](docs/directives.md#including-files)). -->
<!---->
<!-- #### Formatting and configuration -->
<!---->
<!-- - **Turn output into readable docs.** Render JSON as Markdown or HTML tables, or define reusable -->
<!--   templates and JavaScript/TypeScript formatters ([tables](docs/directives.md#tables), [custom directives](docs/custom-directives.md)). -->
<!-- - **Highly customizable and configurable.** Use a local config in your project, a global config for -->
<!--   all your repositories, or a combination of both. Specify which commands are allowed, how to install -->
<!--   missing binaries, run post-update commands, and more ([configuration](docs/configuration.md)). -->
<!---->
<!-- #### Review and automation -->
<!---->
<!-- - **Review changes before applying them.** Preview a diff with `cmdsync status` or approve changes -->
<!--   individually with `cmdsync -i`. Unchanged output leaves files untouched; failed commands preserve -->
<!--   their existing content ([CLI](docs/cli.md)). -->
<!-- - **Catch stale content in your workflow.** Use `cmdsync check` in CI, regenerate with a pre-commit -->
<!--   hook, or open downstream update PRs when you release ([git hooks](docs/git-hooks.md), [GitHub Actions](docs/github-actions.md)). -->
<!---->
## Usage

<details open>
<summary><b><ins>Basic example</ins></b></summary>

> Install `cmdsync` in your project:
>
> ```sh
> npm install --save-dev cmdsync
> npx cmdsync init
> ```
>
> Add a directive to your `README` or any documentation where you want command output to appear:
>
> ```markdown
> <!-- CMDSYNC start: node --version -->
> <!-- CMDSYNC end -->
> ```
>
> Run `npx cmdsync` to fill the region:
>
> ```markdown
> <!-- CMDSYNC start: node --version -->
> v22.18.0
> <!-- CMDSYNC end -->
> ```
>
> The version shown comes from your installed Node.js. Run cmdsync again whenever you want to refresh it. `start` replaces the region between the comments; you can also write `region start` explicitly.

</details>

<details>
<summary><b><ins>Update an inline value</ins></b></summary>

> Keep a value inside a sentence up to date by putting both comments on the same line:
>
> ```markdown
> Built with Node.js <!-- CMDSYNC start: node --version -->v22.18.0<!-- CMDSYNC end -->.
> ```
>
> Running `npx cmdsync` replaces only the value between the comments. Inline updates use `start` and `end` on the same line, rather than a separate `inline` keyword.

</details>

<details>
<summary><b><ins>Fill a codeblock from command output</ins></b></summary>

> `codeblock` updates the fenced block without an end comment; with `lang=ts`, it can also create the block if none exists.
>
> ````markdown
> <!-- CMDSYNC codeblock lang=txt: node --version -->
> ```txt
> ```
> ````
>
> After running `npx cmdsync`, the block is filled with the command output:
>
> ````markdown
> <!-- CMDSYNC codeblock lang=txt: node --version -->
> ```txt
> v22.18.0
> ```
> ````

</details>

<details>
<summary><b><ins>Include a source example</ins></b></summary>

> Keep a code block in sync with a file:
>
> ````markdown
> <!-- CMDSYNC codeblock lang=ts include=./src/example.ts -->
> ```ts
> // This content is replaced with the contents of src/example.ts.
> ```
> ````
>
> Paths are relative to the document containing the directive.

</details>

<details>
<summary><b><ins>Review and check changes</ins></b></summary>

> ```sh
> npx cmdsync status   # Preview changes without writing
> npx cmdsync -i       # Approve changes individually
> npx cmdsync check    # Exit with an error if generated content is stale
> ```

</details>

*See Also:*
- [getting started](docs/getting-started.md) for setup guide
- [directives](docs/directives.md) for tables, other modes, and more examples
- [complete examples](https://github.com/ndonfris/cmdsync/blob/master/examples/)

## Documentation

<!-- CMDSYNC start: node scripts/docs-nav.ts --toc-refs -->
1. **[Getting started][docs/getting-started.md]**: Install, create a config (`cmdsync init`, or `cmdsync migrate` from update-codeblocks), add a first directive, run it, shell completions
   - [Install][docs/getting-started.md#1-install]
   - [Create a config][docs/getting-started.md#2-create-a-config]
   - [Add a directive][docs/getting-started.md#3-add-a-directive]
   - [Run it][docs/getting-started.md#4-run-it]
   - [Shell completions][docs/getting-started.md#5-shell-completions]
2. **[Local install][docs/local-install.md]**: cmdsync as a dev dependency of a project: running it, scripts, CI and git hooks, upgrading
   - [Running it][docs/local-install.md#running-it]
   - [In CI and git hooks][docs/local-install.md#in-ci-and-git-hooks]
   - [Upgrading][docs/local-install.md#upgrading]
3. **[Global install][docs/global-install.md]**: cmdsync on your `PATH` in every repository: the man page, Node version managers, the global config, upgrading and removing
   - [The man page][docs/global-install.md#the-man-page]
   - [Node version managers][docs/global-install.md#node-version-managers]
   - [Using it across repositories][docs/global-install.md#using-it-across-repositories]
   - [Upgrading and removing][docs/global-install.md#upgrading-and-removing]
4. **[Directives][docs/directives.md]**: The directive syntax and modes (region, line, codeblock, console, inline), `include=`, tables, mdx, changelogs, any file, and the comment syntax per file type
   - [region][docs/directives.md#region]
   - [line][docs/directives.md#line]
   - [codeblock][docs/directives.md#codeblock]
   - [console][docs/directives.md#console]
   - [inline][docs/directives.md#inline]
   - [Including files][docs/directives.md#including-files]
   - [Tables][docs/directives.md#tables]
   - [MDX][docs/directives.md#mdx]
   - [Changelogs][docs/directives.md#changelogs]
   - [Any other file][docs/directives.md#any-other-file]
   - [Comment syntax][docs/directives.md#comment-syntax]
5. **[Custom directives][docs/custom-directives.md]**: Your own directives: templates, filters and TypeScript formatters
   - [Templates][docs/custom-directives.md#templates]
   - [Formatters][docs/custom-directives.md#formatters]
6. **[CLI][docs/cli.md]**: Every command and option, `status`/`--diff`, interactive mode, `lint`, shell completions, the man page
   - [Seeing what would change][docs/cli.md#seeing-what-would-change]
   - [Choosing which changes to apply][docs/cli.md#choosing-which-changes-to-apply]
   - [Linting directives][docs/cli.md#linting-directives]
   - [Shell completions][docs/cli.md#shell-completions]
   - [Man page][docs/cli.md#man-page]
7. **[Configuration][docs/configuration.md]**: `cmdsync.json` / `package.json`, allowed commands, installing binaries, the shell, post-update commands, the global config and multiple repositories
   - [`cmdsync.json`][docs/configuration.md#cmdsyncjson]
   - [`package.json`][docs/configuration.md#packagejson]
   - [Recognized commands][docs/configuration.md#recognized-commands]
   - [Installing binaries][docs/configuration.md#installing-binaries]
   - [The shell][docs/configuration.md#the-shell]
   - [Post-update commands][docs/configuration.md#post-update-commands]
   - [Multiple repositories][docs/configuration.md#multiple-repositories]
8. **[Git hooks][docs/git-hooks.md]**: Regenerating on every commit: `cmdsync hook install`, husky, lefthook, pre-commit
   - [`cmdsync hook install`][docs/git-hooks.md#cmdsync-hook-install]
   - [Hook managers][docs/git-hooks.md#hook-managers]
9. **[GitHub Actions][docs/github-actions.md]**: The action, checking or regenerating in CI, and updating other repositories on release
   - [Using the action][docs/github-actions.md#using-the-action]
   - [Regenerate and commit][docs/github-actions.md#regenerate-and-commit]
   - [Without the action][docs/github-actions.md#without-the-action]
   - [Updating other repositories on release][docs/github-actions.md#updating-other-repositories-on-release]
10. **[Generating docs from your source code][docs/generating-docs.md]**: A worked example: tables generated from TypeScript source
    - [Using it from other repositories][docs/generating-docs.md#using-it-from-other-repositories]
11. **[Using it as a library][docs/library.md]**: The API
12. **[Migrating from `update-codeblocks`][docs/migrating.md]**: `cmdsync migrate`
13. **[Development][docs/development.md]**: Building from source, tests, releasing
    - [Building from source][docs/development.md#building-from-source]
    - [Publishing to npm][docs/development.md#publishing-to-npm]
<!-- CMDSYNC end -->

## Contributing

All contributions are welcome! Just fork the repository and open a pull request, or [open an issue](https://github.com/ndonfris/cmdsync/issues).

- [Development](docs/development.md): setup, tests, and the checks CI runs
- [Building from source](docs/development.md#building-from-source): trying your checkout in other repositories
- [Directives](docs/directives.md), [Configuration](docs/configuration.md), [CLI](docs/cli.md): the documented behavior

## License

[MIT](./LICENSE.md)

<!-- CMDSYNC start: node scripts/docs-nav.ts --refs -->
[docs/getting-started.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md
[docs/getting-started.md#1-install]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md#1-install
[docs/getting-started.md#2-create-a-config]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md#2-create-a-config
[docs/getting-started.md#3-add-a-directive]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md#3-add-a-directive
[docs/getting-started.md#4-run-it]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md#4-run-it
[docs/getting-started.md#5-shell-completions]: https://github.com/ndonfris/cmdsync/blob/master/docs/getting-started.md#5-shell-completions
[docs/local-install.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/local-install.md
[docs/local-install.md#running-it]: https://github.com/ndonfris/cmdsync/blob/master/docs/local-install.md#running-it
[docs/local-install.md#in-ci-and-git-hooks]: https://github.com/ndonfris/cmdsync/blob/master/docs/local-install.md#in-ci-and-git-hooks
[docs/local-install.md#upgrading]: https://github.com/ndonfris/cmdsync/blob/master/docs/local-install.md#upgrading
[docs/global-install.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/global-install.md
[docs/global-install.md#the-man-page]: https://github.com/ndonfris/cmdsync/blob/master/docs/global-install.md#the-man-page
[docs/global-install.md#node-version-managers]: https://github.com/ndonfris/cmdsync/blob/master/docs/global-install.md#node-version-managers
[docs/global-install.md#using-it-across-repositories]: https://github.com/ndonfris/cmdsync/blob/master/docs/global-install.md#using-it-across-repositories
[docs/global-install.md#upgrading-and-removing]: https://github.com/ndonfris/cmdsync/blob/master/docs/global-install.md#upgrading-and-removing
[docs/directives.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md
[docs/directives.md#region]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#region
[docs/directives.md#line]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#line
[docs/directives.md#codeblock]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#codeblock
[docs/directives.md#console]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#console
[docs/directives.md#inline]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#inline
[docs/directives.md#including-files]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#including-files
[docs/directives.md#tables]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#tables
[docs/directives.md#mdx]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#mdx
[docs/directives.md#changelogs]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#changelogs
[docs/directives.md#any-other-file]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#any-other-file
[docs/directives.md#comment-syntax]: https://github.com/ndonfris/cmdsync/blob/master/docs/directives.md#comment-syntax
[docs/custom-directives.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/custom-directives.md
[docs/custom-directives.md#templates]: https://github.com/ndonfris/cmdsync/blob/master/docs/custom-directives.md#templates
[docs/custom-directives.md#formatters]: https://github.com/ndonfris/cmdsync/blob/master/docs/custom-directives.md#formatters
[docs/cli.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md
[docs/cli.md#seeing-what-would-change]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md#seeing-what-would-change
[docs/cli.md#choosing-which-changes-to-apply]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md#choosing-which-changes-to-apply
[docs/cli.md#linting-directives]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md#linting-directives
[docs/cli.md#shell-completions]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md#shell-completions
[docs/cli.md#man-page]: https://github.com/ndonfris/cmdsync/blob/master/docs/cli.md#man-page
[docs/configuration.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md
[docs/configuration.md#cmdsyncjson]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#cmdsyncjson
[docs/configuration.md#packagejson]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#packagejson
[docs/configuration.md#recognized-commands]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#recognized-commands
[docs/configuration.md#installing-binaries]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#installing-binaries
[docs/configuration.md#the-shell]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#the-shell
[docs/configuration.md#post-update-commands]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#post-update-commands
[docs/configuration.md#multiple-repositories]: https://github.com/ndonfris/cmdsync/blob/master/docs/configuration.md#multiple-repositories
[docs/git-hooks.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/git-hooks.md
[docs/git-hooks.md#cmdsync-hook-install]: https://github.com/ndonfris/cmdsync/blob/master/docs/git-hooks.md#cmdsync-hook-install
[docs/git-hooks.md#hook-managers]: https://github.com/ndonfris/cmdsync/blob/master/docs/git-hooks.md#hook-managers
[docs/github-actions.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/github-actions.md
[docs/github-actions.md#using-the-action]: https://github.com/ndonfris/cmdsync/blob/master/docs/github-actions.md#using-the-action
[docs/github-actions.md#regenerate-and-commit]: https://github.com/ndonfris/cmdsync/blob/master/docs/github-actions.md#regenerate-and-commit
[docs/github-actions.md#without-the-action]: https://github.com/ndonfris/cmdsync/blob/master/docs/github-actions.md#without-the-action
[docs/github-actions.md#updating-other-repositories-on-release]: https://github.com/ndonfris/cmdsync/blob/master/docs/github-actions.md#updating-other-repositories-on-release
[docs/generating-docs.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/generating-docs.md
[docs/generating-docs.md#using-it-from-other-repositories]: https://github.com/ndonfris/cmdsync/blob/master/docs/generating-docs.md#using-it-from-other-repositories
[docs/library.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/library.md
[docs/migrating.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/migrating.md
[docs/development.md]: https://github.com/ndonfris/cmdsync/blob/master/docs/development.md
[docs/development.md#building-from-source]: https://github.com/ndonfris/cmdsync/blob/master/docs/development.md#building-from-source
[docs/development.md#publishing-to-npm]: https://github.com/ndonfris/cmdsync/blob/master/docs/development.md#publishing-to-npm
<!-- CMDSYNC end -->
