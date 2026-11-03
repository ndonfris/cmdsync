import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ProcessInfo, detectShell, processInfo } from '../src/shell.js';

/** A process tree: pid → [ppid, exe, ...args] */
const tree = (processes: Record<number, [number, string, ...string[]]>) => (pid: number): ProcessInfo | undefined => {
  const p = processes[pid];
  return p && { ppid: p[0], exe: p[1], args: p.slice(2) as string[] };
};
const detect = (processes: Record<number, [number, string, ...string[]]>, env: NodeJS.ProcessEnv = {}) =>
  detectShell({ pid: 10, env, lookup: tree(processes) });

describe('detectShell', () => {
  it('finds the interactive shell cmdsync was started from', () => {
    assert.deepEqual(detect({ 10: [5, '/usr/bin/fish', 'fish'] }), { shell: '/usr/bin/fish', from: 'parent' });
    assert.deepEqual(detect({ 10: [5, '/bin/zsh', '-zsh'] }), { shell: '/bin/zsh', from: 'parent' }, 'a login shell');
  });

  it('skips the `sh -c` of npm/yarn/npx and git hooks, and other programs, on the way up', () => {
    const npx = {
      10: [9, '/usr/bin/dash', 'sh', '-c', 'cmdsync check'],
      9: [8, '/usr/bin/node', 'node', '/usr/lib/node_modules/npm/bin/npx-cli.js', 'cmdsync'],
      8: [7, '/usr/bin/tmux', 'tmux'],
      7: [1, '/usr/bin/fish', 'fish'],
    } satisfies Record<number, [number, string, ...string[]]>;
    assert.deepEqual(detect(npx), { shell: '/usr/bin/fish', from: 'parent' });
    const hook = { 10: [9, '/bin/sh', '/bin/sh', '.git/hooks/pre-commit'], 9: [8, '/usr/bin/git', 'git', 'commit'], 8: [1, '/bin/bash', 'bash', '--login'] } satisfies Record<number, [number, string, ...string[]]>;
    assert.deepEqual(detect(hook), { shell: '/bin/bash', from: 'parent' });
  });

  it('without an interactive shell (CI), takes the nearest one, then $SHELL, then sh', () => {
    assert.deepEqual(detect({ 10: [9, '/usr/bin/bash', 'bash', '-e', '/tmp/step.sh'], 9: [1, '/usr/bin/runner', 'runner'] }), { shell: '/usr/bin/bash', from: 'parent (non-interactive)' });
    assert.deepEqual(detect({ 10: [1, '/usr/bin/node', 'node'] }, { SHELL: '/bin/zsh' }), { shell: '/bin/zsh', from: 'SHELL' });
    assert.deepEqual(detect({}), { shell: 'sh', from: 'default' });
  });

  it('$CMDSYNC_SHELL wins', () => {
    assert.deepEqual(detect({ 10: [1, '/usr/bin/fish', 'fish'] }, { CMDSYNC_SHELL: 'bash' }), { shell: 'bash', from: 'CMDSYNC_SHELL' });
  });

  it('reads real processes', { skip: process.platform === 'win32' && 'no ps on Windows' }, () => {
    const self = processInfo(process.pid);
    assert.equal(self?.ppid, process.ppid);
    assert.ok(self?.args.length);
  });
});
