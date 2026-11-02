import { globSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type ResolvedConfig, defaultEndMarker } from './config.js';
import { type CommandResult, type RegionResult, updateRegions } from './regions.js';
import { type InstallEvent, type InstallMode, createRunner } from './run.js';
import { type CommentSyntax, type RegionSyntax, builtinSyntax } from './syntax.js';

export * from './config.js';
export * from './format.js';
export * from './git.js';
export * from './regions.js';
export * from './run.js';
export * from './syntax.js';

export interface FileResult {
  file: string;
  /** File content differs from what is on disk */
  changed: boolean;
  /** Written to disk (false in `check`/`dryRun` mode) */
  written: boolean;
  /** The regenerated content (equal to what's on disk when nothing changed) */
  content: string;
  regions: RegionResult[];
}

const glob = (patterns: string[], cwd: string, exclude: string[] = []) =>
  globSync(patterns, { cwd, exclude }).map(file => join(cwd, file));

/** Files for explicit `paths` (files or directories), or the config's `include` globs */
export function collectFiles(config: ResolvedConfig, paths: string[] = []): string[] {
  const files = (cwd: string) => glob(config.include, cwd, config.exclude).filter(f => statSync(f).isFile());
  if (paths.length === 0) return files(config.root).sort();

  return [...new Set(paths.flatMap(p => {
    const path = resolve(p);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) throw new Error(`Path does not exist: ${path}`);
    return stats.isDirectory() ? files(path) : [path];
  }))].sort();
}

const fromComment = ([open, close = '']: string[], fences: boolean): CommentSyntax => ({ open: open!, close, fences });

/**
 * Region syntax for a file: `comment` (from `--comment`), then the first
 * matching `syntax` rule, then the built-in table by file extension.
 */
export function syntaxResolver(config: ResolvedConfig): (file: string) => RegionSyntax | undefined {
  const markers = { marker: config.marker, endMarker: config.endMarker };
  const rules = config.syntax.map(rule => ({
    files: new Set(glob(rule.include, config.root)),
    syntax: {
      ...fromComment(rule.comment, rule.fences ?? false),
      marker: rule.marker ?? config.marker,
      endMarker: rule.endMarker ?? (rule.marker ? defaultEndMarker(rule.marker) : config.endMarker),
    },
  }));

  return file => {
    if (config.comment) return { ...fromComment(config.comment, builtinSyntax(file)?.fences ?? false), ...markers };
    const rule = rules.find(r => r.files.has(resolve(file)));
    if (rule) return rule.syntax;
    const builtin = builtinSyntax(file);
    return builtin && { ...builtin, ...markers };
  };
}

export function processFile(
  file: string,
  syntax: RegionSyntax,
  options: { write: boolean; run: (command: string) => CommandResult; },
): FileResult {
  const original = readFileSync(file, 'utf-8');
  if (!original.includes(syntax.marker)) return { file, changed: false, written: false, content: original, regions: [] };
  const { content, results } = updateRegions(original, syntax, options.run);
  const changed = content !== original;
  if (changed && options.write) writeFileSync(file, content, 'utf-8');
  return { file, changed, written: changed && options.write, content, regions: results };
}

export function run(
  config: ResolvedConfig,
  options: {
    paths?: string[];
    write?: boolean;
    install?: InstallMode;
    onFile?: (result: FileResult) => void;
    onInstall?: (event: InstallEvent) => void;
  } = {},
): FileResult[] {
  const syntaxFor = syntaxResolver(config);
  const runner = createRunner(config, { install: options.install, onInstall: options.onInstall });
  return collectFiles(config, options.paths)
    .map(file => {
      const syntax = syntaxFor(file);
      if (!syntax) {
        throw new Error(`No comment syntax known for ${displayPath(file, config.root)}: add a "syntax" rule to the config or pass --comment`);
      }
      return processFile(file, syntax, { write: options.write ?? true, run: runner });
    })
    .filter(result => result.regions.length > 0)
    .map(result => (options.onFile?.(result), result));
}

export const displayPath = (file: string, root: string) => relative(root, file) || file;
