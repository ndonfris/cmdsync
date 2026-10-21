import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import fg from 'fast-glob';
import { type BlockResult, updateCodeblocks } from './codeblocks.js';
import type { ResolvedConfig } from './config.js';
import { runCommand } from './run.js';

export * from './codeblocks.js';
export * from './config.js';
export * from './run.js';

export interface FileResult {
  file: string;
  /** File content differs from what is on disk */
  changed: boolean;
  /** Written to disk (false in `check`/`dryRun` mode) */
  written: boolean;
  blocks: BlockResult[];
}

/** Markdown files for explicit `paths` (files or directories), or the config's `include` globs */
export function collectFiles(config: ResolvedConfig, paths: string[] = []): string[] {
  const glob = (cwd: string) => fg.sync(config.include, { cwd, absolute: true, ignore: config.exclude, dot: false });
  if (paths.length === 0) return glob(config.root).sort();

  return [...new Set(paths.flatMap(p => {
    const path = resolve(p);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) throw new Error(`Path does not exist: ${path}`);
    return stats.isDirectory() ? glob(path) : [path];
  }))].sort();
}

export function processFile(file: string, config: ResolvedConfig, options: { write: boolean; }): FileResult {
  const original = readFileSync(file, 'utf-8');
  const { content, results } = updateCodeblocks(original, config.marker, cmd => runCommand(cmd, config));
  const changed = content !== original;
  if (changed && options.write) writeFileSync(file, content, 'utf-8');
  return { file, changed, written: changed && options.write, blocks: results };
}

export function run(
  config: ResolvedConfig,
  options: { paths?: string[]; write?: boolean; onFile?: (result: FileResult) => void; } = {},
): FileResult[] {
  return collectFiles(config, options.paths)
    .map(file => processFile(file, config, { write: options.write ?? true }))
    .filter(result => result.blocks.length > 0)
    .map(result => (options.onFile?.(result), result));
}

export const displayPath = (file: string, root: string) => relative(root, file) || file;
