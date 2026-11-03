/**
 * `"shell": "auto"` (the default): run commands with the shell cmdsync was started from.
 *
 * Walks up the parent processes to the first interactive shell, so the `sh -c` that
 * npm/yarn/npx and git hooks put in between is skipped (`npx cmdsync` from fish uses
 * fish). Without one, the nearest shell; then `$SHELL`; then `sh`.
 * `$CMDSYNC_SHELL` overrides the detection.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { basename } from 'node:path';

/** Shells that run a command with `<shell> -c <command>` */
export const KNOWN_SHELLS = ['fish', 'bash', 'zsh', 'nu', 'dash', 'ksh', 'mksh', 'ash', 'sh', 'elvish', 'xonsh', 'pwsh', 'tcsh', 'csh'];

export interface ProcessInfo {
  ppid: number;
  /** Executable path when known, else the process name */
  exe: string;
  /** Command line, argv[0] first */
  args: string[];
}

export type ShellSource = 'parent' | 'parent (non-interactive)' | 'CMDSYNC_SHELL' | 'SHELL' | 'default';

/** A process's parent, executable and arguments: /proc on Linux, `ps` elsewhere */
export function processInfo(pid: number): ProcessInfo | undefined {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
      // the name in (parens) can contain spaces and parens, so read the fields after the last `)`
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').filter(Boolean);
      let exe: string;
      try {
        exe = readlinkSync(`/proc/${pid}/exe`);
      } catch {
        exe = readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
      }
      return { ppid, exe, args };
    } catch {
      return undefined;
    }
  }
  if (process.platform === 'win32') return undefined;
  const { stdout, status } = spawnSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf-8' });
  if (status !== 0) return undefined;
  const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) return undefined;
  const args = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf-8' }).stdout.trim().split(/\s+/);
  return { ppid: Number(match[1]), exe: match[2]!, args };
}

/** `fish`, `-fish` (a login shell), `/usr/bin/fish` → `fish`, when it's a known shell */
const shellName = (info: ProcessInfo) => {
  const name = basename(info.exe).replace(/^-/, '').replace(/\s*\(deleted\)$/, '');
  if (KNOWN_SHELLS.includes(name)) return name;
  const argv0 = basename(info.args[0] ?? '').replace(/^-/, '');
  return KNOWN_SHELLS.includes(argv0) ? argv0 : undefined;
};

/** Not running `-c <command>` or a script: no `-c`, and no argument that isn't an option */
const isInteractive = (info: ProcessInfo) => {
  const args = info.args.slice(1);
  return !args.some(a => a === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) || a === '--command') &&
    !args.some(a => !a.startsWith('-'));
};

/**
 * The shell to run commands with, and how it was found. `lookup` and `env` are
 * injectable for tests.
 */
export function detectShell(
  options: { pid?: number; env?: NodeJS.ProcessEnv; lookup?: (pid: number) => ProcessInfo | undefined; } = {},
): { shell: string; from: ShellSource; } {
  const env = options.env ?? process.env;
  if (env.CMDSYNC_SHELL) return { shell: env.CMDSYNC_SHELL, from: 'CMDSYNC_SHELL' };
  const lookup = options.lookup ?? processInfo;

  let nearest: string | undefined;
  let pid = options.pid ?? process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth++) {
    const info = lookup(pid);
    if (!info) break;
    if (shellName(info)) {
      // the executable when it's a real path, so the same binary runs the commands
      const shell = info.exe.startsWith('/') && shellName({ ...info, args: [] }) ? info.exe : shellName(info)!;
      if (isInteractive(info)) return { shell, from: 'parent' };
      nearest ??= shell;
    }
    pid = info.ppid;
  }
  if (nearest) return { shell: nearest, from: 'parent (non-interactive)' };
  if (env.SHELL) return { shell: env.SHELL, from: 'SHELL' };
  return { shell: 'sh', from: 'default' };
}

let cached: ReturnType<typeof detectShell> | undefined;

/** `detectShell()` for this process, looked up once */
export const currentShell = () => process.env.CMDSYNC_SHELL ? detectShell() : cached ??= detectShell();
