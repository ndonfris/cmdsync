# cmdsync

[![npm](https://img.shields.io/npm/v/cmdsync?logo=npm&color=a8322d)](https://www.npmjs.com/package/cmdsync) [![ci](https://img.shields.io/github/actions/workflow/status/ndonfris/cmdsync/ci.yml?branch=master&label=ci&logo=github)](https://github.com/ndonfris/cmdsync/actions/workflows/ci.yml) <!-- CMDSYNC start: node -p "'[![node](https://img.shields.io/badge/node-' + encodeURIComponent(require('./package.json').engines.node) + '-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)'" -->[![node](https://img.shields.io/badge/node-%3E%3D22.18.0-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)<!-- CMDSYNC end --> [![license](https://img.shields.io/badge/license-MIT-6f9fd8)](./LICENSE.md) [![dependencies](https://img.shields.io/badge/dependencies-0-8957e5)](./package.json) [![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](./src/index.ts)

Keep generated parts of your files (docs, tables, changelogs, version strings, config snippets) in sync with the output of real commands.

Put a comment naming a command next to the content it produces:

````markdown
<!-- CMDSYNC start: my-cli --version -->
this line is replaced with the output of `my-cli --version`
<!-- CMDSYNC end -->
````

Running `cmdsync` executes each command and replaces **only the content the comment points at**. The comments stay where they are, so running it again regenerates the same content.

- Works in any file with comments: markdown, mdx, html, yaml, shell, TypeScript, ... ([built-in syntax table](docs/directives.md#comment-syntax), or [your own](docs/directives.md#custom-syntax)).
- Has no runtime dependencies.
- If a command fails (non-zero exit, timeout, or a binary that isn't allowed), its content stays as it was and the run exits with status `1`.
- Re-running with unchanged output changes nothing, so it's safe in CI.

## Install

Requires Node.js `>=22.18`.

### Local install

```fish
# with npm
npm install -D cmdsync

# with yarn
yarn add -D cmdsync

# with pnpm
pnpm add -D cmdsync

# with bun
bun add -d cmdsync

# or run it without installing
npx cmdsync --help
```

### Global install

```fish
# with npm (also installs the man page: man cmdsync)
npm install -g cmdsync

# with yarn
yarn global add cmdsync

# with pnpm
pnpm add -g cmdsync

# with bun
bun add -g cmdsync
```

## Documentation

<!-- CMDSYNC start: node scripts/docs-nav.ts --table -->
| Guide | What's in it |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, create a config (`cmdsync init`, or `cmdsync migrate` from update-codeblocks), add a first directive, run it, shell completions |
| [Local install](docs/local-install.md) | cmdsync as a dev dependency of a project: running it, scripts, CI and git hooks, upgrading |
| [Global install](docs/global-install.md) | cmdsync on your `PATH` in every repository: the man page, Node version managers, the global config, upgrading and removing |
| [Directives](docs/directives.md) | The directive syntax and modes (region, line, codeblock, console, inline), `include=`, tables, mdx, changelogs, any file, and the comment syntax per file type |
| [Custom directives](docs/custom-directives.md) | Your own directives: templates, filters and TypeScript formatters |
| [CLI](docs/cli.md) | Every command and option, `status`/`--diff`, interactive mode, `lint`, shell completions, the man page |
| [Configuration](docs/configuration.md) | `cmdsync.json` / `package.json`, allowed commands, installing binaries, the shell, post-update commands, the global config and multiple repositories |
| [Git hooks](docs/git-hooks.md) | Regenerating on every commit: `cmdsync hook install`, husky, lefthook, pre-commit |
| [GitHub Actions](docs/github-actions.md) | The action, checking or regenerating in CI, and updating other repositories on release |
| [Generating docs from your source code](docs/generating-docs.md) | A worked example: tables generated from TypeScript source |
| [Using it as a library](docs/library.md) | The API |
| [Migrating from `update-codeblocks`](docs/migrating.md) | `cmdsync migrate` |
| [Development](docs/development.md) | Building from source, tests, releasing |

Or start at the [table of contents](docs/README.md).
<!-- CMDSYNC end -->

## Contributing

All contributions are welcome! Just fork the repository and open a pull request, or [open an issue](https://github.com/ndonfris/cmdsync/issues).

- [Development](docs/development.md): setup, tests, and the checks CI runs
- [Building from source](docs/development.md#building-from-source): trying your checkout in other repositories
- [Directives](docs/directives.md), [Configuration](docs/configuration.md), [CLI](docs/cli.md): the documented behavior

## License

[MIT](./LICENSE.md)
