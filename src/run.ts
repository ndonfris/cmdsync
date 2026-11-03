import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { basename, delimiter, join, relative, resolve } from 'node:path';
import type { CommandResult } from './regions.ts';
import type { ResolvedConfig } from './config.ts';

/**
 * Binaries invoked by a shell command line: the first word of every segment
 * split on `|`, `||`, `&&`, `;`, `&`, newlines, `$(` and backticks, ignoring
 * leading `VAR=value` assignments, and skipping quoted text. Best effort, not a full shell parser.
 */
export function commandBinaries(command: string): string[] {
  // quoted text is arguments, not commands: `node -p "a(b) | c"` runs only node
  const unquoted = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""');
  return unquoted
    .split(/\|\|?|&&?|;|\n|\$\(|`|\(|\)/)
    .map(segment => segment.trim().split(/\s+/).filter(word => !/^\w+=/.test(word))[0])
    .filter((word): word is string => !!word)
    .map(word => basename(word.replace(/^['"]|['"]$/g, '')))
    .filter(Boolean);
}

/** Binaries in `command` that the `commands` allowlist does not recognize */
export function unrecognizedBinaries(command: string, allowed: string[]): string[] {
  if (allowed.length === 0) return [];
  const known = new Set(allowed.map(c => basename(c)));
  return commandBinaries(command).filter(bin => !known.has(bin));
}

/** POSIX shell builtins, which are never on PATH */
const BUILTINS = new Set(['.', ':', '[', 'alias', 'cd', 'command', 'echo', 'eval', 'exec', 'exit', 'export', 'false', 'printf', 'read', 'set', 'shift', 'source', 'test', 'true', 'type', 'unset']);

/** Binaries in `command` that aren't on PATH and have no `install` command to get them */
export function missingBinaries(command: string, config: ResolvedConfig): string[] {
  const env = { ...process.env, ...config.env };
  return [...new Set(commandBinaries(command))]
    .filter(bin => !BUILTINS.has(bin) && !config.install[bin] && !onPath(bin, env, config.cwd));
}

/** Run `command` with the config's shell, cwd, env and timeout */
function spawn(command: string, config: ResolvedConfig, timeout = config.timeout, env: Record<string, string> = {}): CommandResult {
  const { stdout, stderr, status, error } = spawnSync(config.shell, ['-c', command], {
    cwd: config.cwd,
    env: { ...process.env, ...config.env, ...env },
    encoding: 'utf-8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (error) return { output: stdout ?? '', status: status ?? 1, error: error.message };
  return { output: status === 0 ? stdout : (stderr || stdout), status: status ?? 1 };
}

/** The failed result for a command the `commands` allowlist rejects, or undefined when it's allowed */
export function rejectUnrecognized(command: string, config: ResolvedConfig): CommandResult | undefined {
  const rejected = unrecognizedBinaries(command, config.commands);
  if (rejected.length === 0) return undefined;
  return {
    output: '',
    status: 1,
    error: `unrecognized command(s): ${rejected.join(', ')} (allowed: ${config.commands.join(', ')})`,
  };
}

export function runCommand(command: string, config: ResolvedConfig): CommandResult {
  return rejectUnrecognized(command, config) ?? spawn(command, config);
}

/** Whether `bin` is an executable on `PATH` (or, when it contains a `/`, relative to `cwd`) */
export function onPath(bin: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): boolean {
  const executable = (file: string) => {
    try {
      accessSync(file, constants.X_OK);
      return statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (bin.includes('/')) return executable(resolve(cwd, bin));
  const extensions = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  return (env.PATH ?? '').split(delimiter).filter(Boolean)
    .some(dir => extensions.some(ext => executable(join(dir, bin + ext))));
}

/**
 * - `missing`: install a binary the first time a directive needs it and it isn't on `PATH`
 * - `always`: install every binary a directive needs once per run, even if it's already there
 * - `never`: don't install anything
 */
export type InstallMode = 'missing' | 'always' | 'never';

/** Installs can download and build, so they get far longer than a command's `timeout` */
export const INSTALL_TIMEOUT = 10 * 60_000;

export interface InstallEvent {
  bin: string;
  command: string;
  result: CommandResult;
}

/**
 * `runCommand`, but first runs the config's `install` command for each binary
 * of the directive that needs one. Each binary is installed at most once per
 * runner, and a failed install fails every directive that uses that binary.
 */
export function createRunner(
  config: ResolvedConfig,
  options: { install?: InstallMode; onInstall?: (event: InstallEvent) => void; } = {},
): (command: string) => CommandResult {
  const mode = options.install ?? 'missing';
  const env = { ...process.env, ...config.env };
  const installed = new Map<string, CommandResult>();

  const install = (bin: string): CommandResult | undefined => {
    const command = config.install[bin];
    if (mode === 'never' || !command) return undefined;
    if (installed.has(bin)) return installed.get(bin);
    if (mode === 'missing' && onPath(bin, env, config.cwd)) return undefined;

    let result = spawn(command, config, INSTALL_TIMEOUT);
    if (result.status === 0 && !result.error && !onPath(bin, env, config.cwd)) {
      result = { ...result, status: 1, error: `\`${command}\` succeeded, but ${bin} is still not on PATH` };
    }
    installed.set(bin, result);
    options.onInstall?.({ bin, command, result });
    return result;
  };

  return command => {
    const rejected = rejectUnrecognized(command, config);
    if (rejected) return rejected;
    for (const bin of new Set(commandBinaries(command))) {
      const result = install(bin);
      if (result && (result.status !== 0 || result.error)) {
        return { ...result, status: result.status || 1, error: `installing ${bin} failed: ${result.error ?? `\`${config.install[bin]}\` exited with status ${result.status}`}` };
      }
    }
    return spawn(command, config);
  };
}

export interface PostUpdateEvent {
  command: string;
  result: CommandResult;
}

/**
 * Run the config's `postUpdate` commands in order, stopping at the first that
 * fails. `changed` (absolute paths) is passed as `CMDSYNC_CHANGED_FILES`.
 * Like installs, they get `INSTALL_TIMEOUT`, since formatters and builds can be slow.
 */
export function runPostUpdate(config: ResolvedConfig, changed: string[]): PostUpdateEvent[] {
  const env = { CMDSYNC_CHANGED_FILES: changed.map(f => relative(config.root, f)).join('\n') };
  const events: PostUpdateEvent[] = [];
  for (const command of config.postUpdate) {
    const result = spawn(command, config, INSTALL_TIMEOUT, env);
    events.push({ command, result });
    if (result.status !== 0 || result.error) break;
  }
  return events;
}
