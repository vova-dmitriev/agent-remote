import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpStatus } from '@protocol';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  events: [] as string[],
  finishTunnel: () => {},
  tunnelConfig: undefined as unknown,
  exitDuringWorker: false,
  failWorkerClose: false,
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, stdout: string, stderr: string) => void,
  ) => {
    state.events.push('database');
    callback(null, '', '');
  },
}));

vi.mock('../apps/daemon/src/cli/personal/personal-tunnel.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../apps/daemon/src/cli/personal/personal-tunnel.js')>()),
  startNamedTunnel: async (_port: number, config: unknown) => {
    state.events.push('named-tunnel');
    state.tunnelConfig = config;

    return {
      origin: 'https://agent.example.com',
      exited: new Promise<void>((resolve) => {
        state.finishTunnel = resolve;
      }),
      close: async () => {
        state.events.push('close-tunnel');
        state.finishTunnel();
      },
    };
  },
}));

vi.mock('../apps/server/src/app/create-relay.js', () => ({
  createRelay: async (config: { publicOrigin: string }) => {
    state.events.push('relay:' + config.publicOrigin);

    return {
      db: {},
      listen: async () => {
        state.events.push('listen');
      },
      close: async () => {
        state.events.push('close-relay');
      },
    };
  },
}));

vi.mock('../apps/server/src/notifications/worker.js', () => ({
  NotificationWorker: class {
    async start() {
      state.events.push('worker');

      if (state.exitDuringWorker) {
        state.finishTunnel();
        await Promise.resolve();
      }
    }
    async close() {
      state.events.push('close-worker');

      if (state.failWorkerClose) {
        throw new Error('WORKER_CLOSE_FAILED');
      }
    }
  },
}));

vi.mock('../apps/daemon/src/cli/personal/personal-bot.js', () => ({
  personalBot: () => ({
    check: async () => {
      state.events.push('bot-check');

      return 'fixture_bot';
    },
    setMenu: async (origin: string) => {
      state.events.push('menu:' + origin);
    },
    setName: async () => {
      state.events.push('bot-name');
    },
  }),
}));

vi.mock('../apps/daemon/src/config.js', () => ({
  loadConfig: async () => ({ relayUrl: 'https://other.example.com' }),
}));

vi.mock('../apps/daemon/src/main.js', () => ({
  startDaemon: async () => {
    throw new Error('UNEXPECTED_DAEMON_START');
  },
}));

vi.mock('../apps/daemon/src/desktop/bridge-client.js', () => ({ installationRoot: () => '/unused' }));

vi.mock('../apps/daemon/src/cli/pairing/connect.js', () => ({
  ensureMacConnected: async () => {
    throw new Error('UNEXPECTED_PAIRING');
  },
}));

import { startPersonal } from '../apps/daemon/src/cli/personal/personal.js';

let root: string;
const tunnelId = '00000000-0000-4000-8000-000000000001';

beforeEach(async () => {
  state.events.length = 0;
  state.tunnelConfig = undefined;
  state.exitDuringWorker = false;
  state.failWorkerClose = false;
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  root = await mkdtemp(join(tmpdir(), 'permanent-launch-'));
  await mkdir(join(root, 'dist/mini-app'), { recursive: true });
  await writeFile(join(root, 'dist/mini-app/index.html'), 'fixture');

  await writeFile(
    join(root, '.env'),
    `BOT_TOKEN=123456:private_fixture\nPERSONAL_PUBLIC_ORIGIN=https://agent.example.com\nPERSONAL_TUNNEL_ID=${tunnelId}\nPERSONAL_TUNNEL_CREDENTIALS_FILE=/private/fixture.json\n`,
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('waits for public health before changing Telegram or starting notification workers', async () => {
  let healthOptions: RequestInit | undefined;
  let releaseHealth!: (response: Response) => void;
  let reachedHealth!: () => void;

  const reached = new Promise<void>((resolve) => {
    reachedHealth = resolve;
  });

  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    healthOptions = options;
    expect(url).toBe('https://agent.example.com/health');
    expect(state.events).toContain('listen');
    reachedHealth();

    return new Promise<Response>((resolve) => {
      releaseHealth = resolve;
    });
  });

  const starting = startPersonal(root);

  await reached;
  expect(state.events.some((event) => event.startsWith('menu:'))).toBe(false);
  expect(state.events).not.toContain('worker');
  releaseHealth(Response.json({ status: 'ok' }));
  const personal = await starting;

  try {
    expect(personal?.origin).toBe('https://agent.example.com');
    expect(healthOptions?.redirect).toBe('error');

    expect(state.tunnelConfig).toEqual({
      origin: 'https://agent.example.com',
      tunnelId,
      credentialsFile: '/private/fixture.json',
    });

    expect(state.events).toContain('menu:https://agent.example.com');
    expect(state.events).toContain('worker');
  } finally {
    await personal?.close();
  }

  expect(state.events).toContain('close-worker');
  expect(state.events.slice(-2)).toEqual(['close-relay', 'close-tunnel']);
});

it('cleans up an early tunnel exit before touching the bot menu or workers', async () => {
  vi.stubGlobal('fetch', async () => {
    state.finishTunnel();
    await Promise.resolve();

    return Response.json({ status: 'ok' });
  });

  await expect(startPersonal(root)).rejects.toThrow(/^TUNNEL_EXITED$/);
  expect(state.events.some((event) => event.startsWith('menu:'))).toBe(false);
  expect(state.events).not.toContain('worker');
  expect(state.events.slice(-2)).toEqual(['close-relay', 'close-tunnel']);
});

it('refuses partial permanent config before contacting Telegram or starting the database', async () => {
  await writeFile(
    join(root, '.env'),
    'BOT_TOKEN=123456:private_fixture\nPERSONAL_PUBLIC_ORIGIN=https://agent.example.com\n',
  );

  await expect(startPersonal(root)).rejects.toThrow(/^INCOMPLETE_PERSONAL_TUNNEL_CONFIG$/);
  expect(state.events).toEqual([]);
});

it('closes the relay and tunnel when public HTTPS health never succeeds', async () => {
  let reachedHealth!: () => void;

  const reached = new Promise<void>((resolve) => {
    reachedHealth = resolve;
  });

  vi.stubGlobal('fetch', async () => {
    reachedHealth();

    return Response.json({ status: 'unavailable' }, { status: HttpStatus.ServiceUnavailable });
  });

  vi.useFakeTimers();

  try {
    const starting = startPersonal(root);
    const rejected = expect(starting).rejects.toThrow(/^TUNNEL_HEALTH_TIMEOUT$/);

    await reached;
    await vi.advanceTimersByTimeAsync(182000);
    await rejected;
    expect(state.events.some((event) => event.startsWith('menu:'))).toBe(false);
    expect(state.events).not.toContain('worker');
    expect(state.events.slice(-2)).toEqual(['close-relay', 'close-tunnel']);
  } finally {
    vi.useRealTimers();
  }
});

it('does not report ready when the tunnel exits during worker startup', async () => {
  state.exitDuringWorker = true;
  vi.stubGlobal('fetch', async () => Response.json({ status: 'ok' }));

  const personal = await startPersonal(root).then(
    async (result) => {
      await result?.close();

      return result;
    },
    (error) => error,
  );

  expect(personal).toBeInstanceOf(Error);
  expect((personal as Error).message).toBe('TUNNEL_EXITED');
  expect(state.events).toContain('close-worker');
  expect(state.events.slice(-2)).toEqual(['close-relay', 'close-tunnel']);
});

it('still closes the relay and tunnel if worker shutdown fails', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ status: 'ok' }));
  const personal = await startPersonal(root);

  state.failWorkerClose = true;
  await expect(personal!.close()).rejects.toThrow(/^WORKER_CLOSE_FAILED$/);
  expect(state.events.slice(-3)).toEqual(['close-worker', 'close-relay', 'close-tunnel']);
});
