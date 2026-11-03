#!/usr/bin/env node
/**
 * Navigation for docs/, from one ordered list (DOCS), used by cmdsync regions:
 *
 *   node scripts/docs-nav.ts --footer docs/cli.md   the ← previous · contents · next → footer of a doc
 *   node scripts/docs-nav.ts --toc                  docs/README.md's table of contents (each doc and its sections)
 *   node scripts/docs-nav.ts --table                the root README's table of the docs
 *
 * Adding, removing or reordering a doc is a change to DOCS; `yarn docs` updates every
 * footer and both tables, and `yarn docs:check` fails while one is out of date.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** The docs, in reading order */
export const DOCS: { file: string; description: string; }[] = [
  { file: 'getting-started.md', description: 'Install, create a config (`cmdsync init`, or `cmdsync migrate` from update-codeblocks), add a first directive, run it, shell completions' },
  { file: 'local-install.md', description: 'cmdsync as a dev dependency of a project: running it, scripts, CI and git hooks, upgrading' },
  { file: 'global-install.md', description: 'cmdsync on your `PATH` in every repository: the man page, Node version managers, the global config, upgrading and removing' },
  { file: 'directives.md', description: 'The directive syntax and modes (region, line, codeblock, console, inline), `include=`, tables, mdx, changelogs, any file, and the comment syntax per file type' },
  { file: 'custom-directives.md', description: 'Your own directives: templates, filters and TypeScript formatters' },
  { file: 'cli.md', description: 'Every command and option, `status`/`--diff`, interactive mode, `lint`, shell completions, the man page' },
  { file: 'configuration.md', description: '`cmdsync.json` / `package.json`, allowed commands, installing binaries, the shell, post-update commands, the global config and multiple repositories' },
  { file: 'git-hooks.md', description: 'Regenerating on every commit: `cmdsync hook install`, husky, lefthook, pre-commit' },
  { file: 'github-actions.md', description: 'The action, checking or regenerating in CI, and updating other repositories on release' },
  { file: 'generating-docs.md', description: 'A worked example: tables generated from TypeScript source' },
  { file: 'library.md', description: 'The API' },
  { file: 'migrating.md', description: '`cmdsync migrate`' },
  { file: 'development.md', description: 'Building from source, tests, releasing' },
];

const DIR = join(import.meta.dirname, '..', 'docs');

/** A doc's lines outside fenced code blocks */
function prose(file: string): string[] {
  const lines = readFileSync(join(DIR, file), 'utf-8').split('\n');
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(line)) fence = undefined;
    } else if (opening) {
      fence = opening[1];
    } else {
      out.push(line);
    }
  }
  return out;
}

const title = (file: string) => prose(file).find(l => l.startsWith('# '))?.slice(2) ?? file;

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces as `-` */
const anchor = (heading: string) => heading.trim().toLowerCase().replace(/`/g, '').replace(/[^\w\- ]/g, '').replace(/ /g, '-');

function footer(path: string): string {
  const i = DOCS.findIndex(d => d.file === basename(path));
  if (i === -1) throw new Error(`${path} isn't in DOCS (scripts/docs-nav.ts)`);
  const previous = DOCS[i - 1];
  const next = DOCS[i + 1];
  return [
    '---',
    '',
    [
      previous ? `[← ${title(previous.file)}](${previous.file})` : '',
      '[Contents](README.md)',
      next ? `[${title(next.file)} →](${next.file})` : '',
    ].filter(Boolean).join(' · '),
  ].join('\n');
}

function toc(): string {
  return DOCS.map(({ file, description }, i) => {
    const sections = prose(file).filter(l => l.startsWith('## ')).map(l => l.slice(3));
    return [
      `${i + 1}. **[${title(file)}](${file})**: ${description}`,
      ...sections.map(s => `   - [${s}](${file}#${anchor(s)})`),
    ].join('\n');
  }).join('\n');
}

function table(): string {
  return [
    '| Guide | What\'s in it |',
    '| --- | --- |',
    ...DOCS.map(({ file, description }) => `| [${title(file)}](docs/${file}) | ${description} |`),
    '',
    'Or start at the [table of contents](docs/README.md).',
  ].join('\n');
}

if (process.argv[1] === import.meta.filename) {
  const [flag, path] = process.argv.slice(2);
  if (flag === '--footer' && path) console.log(footer(path));
  else if (flag === '--toc') console.log(toc());
  else if (flag === '--table') console.log(table());
  else {
    console.error('usage: node scripts/docs-nav.ts --footer docs/<file>.md | --toc | --table');
    process.exitCode = 2;
  }
}
