#!/bin/sh
# Entry point for the pre-commit.com hook (.pre-commit-hooks.yaml). pre-commit
# runs this from its cached clone of this repo: build the CLI there once, then
# run it in the project being committed.
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
if [ ! -f "$repo/dist/cli.js" ]; then
  (cd "$repo" && npm install --no-save --no-package-lock --no-audit --no-fund --include=dev --ignore-scripts >/dev/null && npx tsc -p tsconfig.json)
fi
exec node "$repo/dist/cli.js" "$@"
