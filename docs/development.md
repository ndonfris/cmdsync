# Development

```fish
yarn install
yarn test           # node --test on the TypeScript source, reported by tests/reporter.mjs; or only some: yarn test tests/cli.test.ts
yarn test:coverage  # the same, with node's built-in coverage report for src/
yarn verify         # build, then test (run-s build test); takes test files too
yarn watch          # build + test on every change, with a timestamped ✓/✗ line per run; keys: a all, f failed, p pattern, b build only, t tests only, k typecheck only, o coverage, c clear, h help, q quit (a key mid-run restarts with it); yarn watch cli starts with tests matching cli
yarn typecheck
yarn build          # emits dist/
yarn docs           # regenerate the README's and docs/' regions with cmdsync itself
yarn build:man      # regenerate man/cmdsync.1 from the CLI's option tables (yarn build runs it too)
```

## Building from source

Build it, then link it so `cmdsync` on your `PATH` runs your checkout, in every repository on the machine:

```fish
git clone https://github.com/ndonfris/cmdsync
cd cmdsync
yarn install     # also builds dist/ (the `prepare` script)
yarn link        # or: npm link
cmdsync --version
```

`yarn link` puts the binary in `yarn global bin`, and `npm link` in `npm prefix -g`'s `bin/`, so that directory has to be on your `PATH`. Run `yarn build` (or `npx tsc -p tsconfig.json --watch`) after changing `src/`, since the linked `cmdsync` runs `dist/cli.js`. To use the checkout as a dependency of one project instead, run `yarn link cmdsync` in that project, or install it from the path: `yarn add -D file:../cmdsync`. Undo the global link with `yarn unlink` (or `npm unlink -g cmdsync`) in the checkout.

Without linking, `node src/cli.ts <args>` runs the TypeScript source directly (Node strips the types).

## Publishing to npm

Releases are published by [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) when a GitHub release is published. It checks that the release tag is `v` + the `package.json` version, runs the typecheck, tests and `docs:check`, builds, and runs `npm publish`, which publishes `dist/`, the schema, the README and the license (see `files` in `package.json`).

**One-time setup**

1. The GitHub repository has to be `ndonfris/cmdsync` (the `repository` url in `package.json`), since trusted publishing is set up for that repository and workflow. (Publishing with `--provenance`, which adds a signed link from the package to the commit that built it, also needs the repository to be public; `publish.yml` doesn't use it while `ndonfris/cmdsync` is private.)
2. Publish the first version by hand, because npm only lets you configure trusted publishing on a package that exists:

   ```fish
   npm login
   yarn build && yarn test
   npm publish --dry-run   # check the file list
   npm publish
   ```

3. On npmjs.com, under the package's *Settings* > *Trusted publishing*, add a GitHub Actions publisher: owner `ndonfris`, repository `cmdsync`, workflow `publish.yml`, environment `npm`. The workflow then authenticates with OIDC and needs no token. (Without trusted publishing, add a granular npm access token as the `NPM_TOKEN` repository secret instead.)
4. Create the `npm` environment under the repository's *Settings* > *Environments*. Add required reviewers to it if a release should wait for an approval before publishing.

**Each release**

```fish
npm version minor    # or patch / major: bumps package.json, commits, and tags v<version>
git push --follow-tags
gh release create (git describe --tags --abbrev=0) --generate-notes
```

Publishing the release starts the workflow. To check it without publishing, run the workflow by hand (*Actions* > *publish* > *Run workflow*), which defaults to `npm publish --dry-run`. Users of the [action](github-actions.md#using-the-action) and the [reusable workflow](github-actions.md#updating-other-repositories-on-release) pin a git ref, so moving a major tag (`git tag -f v1 && git push -f origin v1`) is a separate step from the npm release.

<!-- CMDSYNC start: node scripts/docs-nav.ts --footer docs/development.md -->
---

[← Migrating from `update-codeblocks`](migrating.md) · [Contents](README.md)
<!-- CMDSYNC end -->
