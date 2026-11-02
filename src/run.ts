import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import type { CommandResult } from './regions.js';
import type { ResolvedConfig } from './config.js';

/**
 * Binaries invoked by a shell command line: the first word of every segment
 * split on `|`, `||`, `&&`, `;`, `&`, newlines, `$(` and backticks, ignoring
 * leading `VAR=value` assignments. Best effort, not a full shell parser.
 */
export function commandBinaries(command: string): string[] {
  return command
    .split(/\|\|?|&&?|;|\n|\$\(|`|\(|\)/)
    .map(segment => segment.trim().split(/\s+/).filter(word => !/^\w+=/.test(word))[0])
    .filter((word): word is string => !!word)
    .map(word => basename(word.replace(/^['"]|['"]$/g, '')));
}

/** Binaries in `command` that the `commands` allowlist does not recognize */
export function unrecognizedBinaries(command: string, allowed: string[]): string[] {
  if (allowed.length === 0) return [];
  const known = new Set(allowed.map(c => basename(c)));
  return commandBinaries(command).filter(bin => !known.has(bin));
}

export function runCommand(command: string, config: ResolvedConfig): CommandResult {
  const rejected = unrecognizedBinaries(command, config.commands);
  if (rejected.length > 0) {
    return {
      output: '',
      status: 1,
      error: `unrecognized command(s): ${rejected.join(', ')} (allowed: ${config.commands.join(', ')})`,
    };
  }

  const { stdout, stderr, status, error } = spawnSync(config.shell, ['-c', command], {
    cwd: config.cwd,
    env: { ...process.env, ...config.env },
    encoding: 'utf-8',
    timeout: config.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (error) return { output: stdout ?? '', status: status ?? 1, error: error.message };
  return { output: status === 0 ? stdout : (stderr || stdout), status: status ?? 1 };
}
