import { globSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { type ResolvedConfig, defaultEndMarker } from './config.ts';
import { type LoadedFormatter, customHooks } from './custom.ts';
import { type CommandResult, type RegionResult, updateRegions } from './regions.ts';
import { type InstallEvent, type InstallMode, createRunner, rejectUnrecognized } from './run.ts';
import { type CommentSyntax, type RegionSyntax, builtinSyntax } from './syntax.ts';

export * from './config.ts';
export * from './custom.ts';
export * from './diff.ts';
export * from './format.ts';
export * from './git.ts';
export * from './global.ts';
export * from './init.ts';
export * from './migrate.ts';
export * from './regions.ts';
export * from './run.ts';
export * from './syntax.ts';

export interface FileResult {
  file: string;
  /** File content differs from what is on disk */
  changed: boolean;
  /** Written to disk (false in `check`/`dryRun` mode) */
  written: boolean;
  /** The file as it was read */
  original: string;
  /** The regenerated content (equal to `original` when nothing changed) */
  content: string;
  regions: RegionResult[];
  /** 0-based lines that mention the marker but aren't a directive or a matched end marker */
  stray: number[];
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
  const markers = { marker: config.marker, endMarker: config.endMarker, directives: config.directives };
  const rules = config.syntax.map(rule => ({
    files: new Set(glob(rule.include, config.root)),
    syntax: {
      ...fromComment(rule.comment, rule.fences ?? false),
      directives: config.directives,
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

/** Reads `include=` paths relative to the file with the directive */
export function includeReader(file: string): (path: string) => CommandResult {
  return path => {
    try {
      return { output: readFileSync(resolve(dirname(file), path), 'utf-8'), status: 0 };
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (err as Error).message;
      return { output: '', status: 1, error: `include ${path}: ${reason}` };
    }
  };
}

export function processFile(
  file: string,
  syntax: RegionSyntax,
  options: {
    write: boolean;
    run: (command: string) => CommandResult;
    lint?: boolean;
    /** For custom directives: the config, and their loaded formatters (see `loadFormatters`) */
    config?: ResolvedConfig;
    formatters?: Map<string, LoadedFormatter>;
  },
): FileResult {
  const original = readFileSync(file, 'utf-8');
  const unchanged = { file, changed: false, written: false, original, content: original };
  if (!original.includes(syntax.marker.trim().split(/\s+/)[0]!)) return { ...unchanged, regions: [], stray: [] };
  const custom = options.config ? customHooks(options.config, file, options.formatters, options.lint) : undefined;
  const { content, results, stray } = updateRegions(original, syntax, options.run, { read: includeReader(file), lint: options.lint, custom });
  if (options.lint) return { ...unchanged, regions: results, stray };
  const changed = content !== original;
  if (changed && options.write) writeFileSync(file, content, 'utf-8');
  return { file, changed, written: changed && options.write, original, content, regions: results, stray };
}

/** A `run` for linting: rejects commands the `commands` allowlist doesn't recognize, without running anything */
const lintRunner = (config: ResolvedConfig) => (command: string): CommandResult =>
  rejectUnrecognized(command, config) ?? { output: '', status: 0 };

export function run(
  config: ResolvedConfig,
  options: {
    paths?: string[];
    write?: boolean;
    install?: InstallMode;
    /** Validate every directive without running commands or writing (see `UpdateOptions.lint`) */
    lint?: boolean;
    /** Custom directives' formatter modules, from `loadFormatters(config)` */
    formatters?: Map<string, LoadedFormatter>;
    onFile?: (result: FileResult) => void;
    onInstall?: (event: InstallEvent) => void;
    /** Every file that's scanned, before it's processed (including ones without directives) */
    onScan?: (file: string, syntax: RegionSyntax) => void;
    /** Every command a directive ran, with how long it took */
    onCommand?: (command: string, result: CommandResult, ms: number) => void;
  } = {},
): FileResult[] {
  const syntaxFor = syntaxResolver(config);
  const base = options.lint ? lintRunner(config) : createRunner(config, { install: options.install, onInstall: options.onInstall });
  const runner = options.onCommand
    ? (command: string) => {
      const start = performance.now();
      const result = base(command);
      options.onCommand!(command, result, performance.now() - start);
      return result;
    }
    : base;
  return collectFiles(config, options.paths)
    .map(file => {
      const syntax = syntaxFor(file);
      if (!syntax) {
        throw new Error(`No comment syntax known for ${displayPath(file, config.root)}: add a "syntax" rule to the config or pass --comment`);
      }
      options.onScan?.(file, syntax);
      return processFile(file, syntax, {
        write: !options.lint && (options.write ?? true),
        run: runner,
        lint: options.lint,
        config,
        formatters: options.formatters,
      });
    })
    .filter(result => result.regions.length > 0 || result.stray.length > 0)
    .map(result => (options.onFile?.(result), result));
}

export const displayPath = (file: string, root: string) => relative(root, file) || file;
