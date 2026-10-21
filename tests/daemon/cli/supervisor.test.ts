import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Supervisor } from '@daemon/cli/supervisor/supervisor.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function harness(batches: unknown[][]) {
  const started: { home: string; env: NodeJS.ProcessEnv; child: EventEmitter }[] = [];

  const fetch = vi.fn(async () => Response.json({ devices: batches.shift() ?? [] }));

  return {
    started,
    fetch,
    async supervisor() {
      const usersRoot = await mkdtemp(join(tmpdir(), 'supervisor-'));

      roots.push(usersRoot);

      return {
        usersRoot,
        supervisor: new Supervisor({
          relayUrl: 'http://127.0.0.1:3000',
          operatorToken: 'synthetic-operator-token',
          usersRoot,
          projectsRoot: '/srv/projects',
          fetch,
          start: (home, env) => {
            const child = Object.assign(new EventEmitter(), { kill: vi.fn() });

            started.push({ home, env, child });

            return child;
          },
        }),
      };
    },
  };
}

it("writes each new user's device and keeps one multi-user daemon running per user", async () => {
  const f = harness([[{ ownerId: 'owner-1', deviceId: 'device-1', deviceToken: 'token-1' }], []]);
  const { usersRoot, supervisor } = await f.supervisor();

  await supervisor.tick();

  const home = join(usersRoot, 'owner-1');

  expect(JSON.parse(await readFile(join(home, 'device.json'), 'utf8'))).toEqual({
    relayUrl: 'http://127.0.0.1:3000',
    deviceId: 'device-1',
    deviceToken: 'token-1',
  });

  expect((await stat(join(home, 'device.json'))).mode & 0o777).toBe(0o600);

  expect(f.fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/operator/devices', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-operator-token' },
  });

  expect(f.started).toHaveLength(1);

  expect(f.started[0]).toMatchObject({
    home,
    env: { CLAUDE_REMOTE_HOME: home, REMOTE_MULTI_USER: '1', REMOTE_PROJECTS_ROOT: '/srv/projects' },
  });

  await supervisor.tick();
  expect(f.started).toHaveLength(1);

  // A daemon that exits is started again on the next round.
  f.started[0]!.child.emit('exit', 1);
  await supervisor.tick();
  expect(f.started).toHaveLength(2);
});

it('never writes outside the users root, whatever owner id the relay sends', async () => {
  const f = harness([[{ ownerId: '../escape', deviceId: 'device-1', deviceToken: 'token-1' }]]);
  const { supervisor } = await f.supervisor();

  await supervisor.tick();

  expect(f.started).toHaveLength(0);
});
