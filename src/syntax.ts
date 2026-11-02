import { basename, extname } from 'node:path';

/** How a comment is written in a given file type */
export interface CommentSyntax {
  /** Text that opens a comment: `<!--`, `{/*`, `#`, `//`, ... */
  open: string;
  /** Text that closes it, empty for line comments */
  close: string;
  /**
   * Markdown-like file: directives inside fenced code blocks and inline code
   * are ignored, and a directive without an end marker updates the body of
   * the fenced code block that follows it.
   */
  fences: boolean;
}

/** Comment syntax plus the start/end text that delimits a region */
export interface RegionSyntax extends CommentSyntax {
  /** `<!-- MARKER: command -->` */
  marker: string;
  /** `<!-- END_MARKER -->` */
  endMarker: string;
}

const html: CommentSyntax = { open: '<!--', close: '-->', fences: false };
const markdown: CommentSyntax = { ...html, fences: true };
/** MDX 2+ rejects html comments, only JSX comments work */
const mdx: CommentSyntax = { open: '{/*', close: '*/}', fences: true };
const line = (open: string): CommentSyntax => ({ open, close: '', fences: false });
const block = (open: string, close: string): CommentSyntax => ({ open, close, fences: false });

/** Built-in comment syntax, by file extension */
export const BUILTIN_SYNTAX: [CommentSyntax, string[]][] = [
  [markdown, ['md', 'markdown']],
  [mdx, ['mdx']],
  [html, ['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'astro', 'xhtml', 'plist']],
  [line('#'), [
    'sh', 'bash', 'zsh', 'fish', 'ksh', 'nu', 'ps1', 'py', 'rb', 'pl', 'r', 'jl', 'cr', 'ex', 'exs', 'nim',
    'yml', 'yaml', 'toml', 'conf', 'cfg', 'properties', 'tf', 'hcl', 'nix', 'cmake', 'mk', 'env', 'gitignore',
    'dockerignore', 'npmignore', 'prettierignore', 'gitattributes', 'editorconfig', 'service',
  ]],
  [line('//'), [
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'jsonc', 'json5', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
    'cs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'go', 'rs', 'swift', 'dart', 'zig', 'php', 'proto',
    'scss', 'less', 'v', 'odin',
  ]],
  [block('/*', '*/'), ['css']],
  [line('--'), ['lua', 'sql', 'hs', 'elm', 'ada', 'purs']],
  [line(';'), ['ini', 'lisp', 'el', 'clj', 'cljs', 'scm', 'rkt', 'asm', 's']],
  [line('%'), ['tex', 'sty', 'erl', 'hrl']],
  [line('"'), ['vim']],
];

const BY_EXTENSION = new Map(BUILTIN_SYNTAX.flatMap(([syntax, exts]) => exts.map(ext => [ext, syntax] as const)));

/** Files usually written without an extension */
export const BY_BASENAME = new Map<string, CommentSyntax>([
  ...['Makefile', 'GNUmakefile', 'Dockerfile', 'Containerfile', 'Justfile', 'justfile', 'Gemfile', 'Rakefile',
    'Brewfile', 'Procfile', 'CODEOWNERS', 'Vagrantfile', '.bashrc', '.zshrc', '.profile'].map(name => [name, line('#')] as const),
  ['.vimrc', line('"')],
]);

/** Built-in comment syntax for `file`, by basename then extension (`.gitignore` counts as extension `gitignore`) */
export function builtinSyntax(file: string): CommentSyntax | undefined {
  const name = basename(file);
  const ext = (extname(name) || (name.startsWith('.') ? name : '')).slice(1).toLowerCase();
  return BY_BASENAME.get(name) ?? BY_EXTENSION.get(ext);
}
