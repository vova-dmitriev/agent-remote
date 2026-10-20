import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { runCodex } from '../../../apps/daemon/src/cli/codex.js';

const spawned = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawned }));

vi.mock('../../../apps/daemon/src/code/hooks/ipc.js', () => ({
  requestLocal: async () => ({ type: 'codex_result', result: { connected: 0 } }),
}));

vi.mock('../../../apps/daemon/src/config.js', () => ({
  localSecret: async () => 'synthetic',
  socketPath: () => '/private/hooks.sock',
  stateDirectory: () => '/private/state',
}));

vi.mock('../../../apps/daemon/src/codex/launcher.js', () => ({
  ensureManagedCodexSocket: async () => '/private/managed.sock',
}));

beforeEach(() => {
  spawned.mockImplementation(() => {
    const child = new EventEmitter();

    queueMicrotask(() => child.emit('exit', 0));

    return child;
  });
});

it('starts a new terminal session in the calling directory, not the shared server directory', async () => {
  expect(await runCodex(['-m', 'synthetic-model'])).toBe(0);

  expect(spawned).toHaveBeenLastCalledWith(
    'codex',
    ['--remote', 'unix:///private/managed.sock', '--cd', process.cwd(), '-m', 'synthetic-model'],
    { stdio: 'inherit', shell: false },
  );
});

it('preserves an explicitly selected working directory and the original directory during resume', async () => {
  for (const args of [
    ['--cd', '/explicit/workspace'],
    ['-C/explicit/workspace'],
    ['resume', 'synthetic-thread'],
  ]) {
    expect(await runCodex(args)).toBe(0);

    expect(spawned).toHaveBeenLastCalledWith('codex', ['--remote', 'unix:///private/managed.sock', ...args], {
      stdio: 'inherit',
      shell: false,
    });
  }
});
