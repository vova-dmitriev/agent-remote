import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PassThrough } from 'node:stream';
import { join } from 'node:path';
import {
  createBrowserFixture,
  cleanupBrowserFixture,
  pendingGrant,
} from '../../helpers/local/browser-cli-fixture.js';
import { runBrowserCli } from '@daemon/cli/browser/index.js';
import { LocalOrigin } from '@protocol';
import { CompanionEnvironment } from '@daemon/local/supervisor/values.js';

const run = promisify(execFile);
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const origin = `chrome-extension://${extensionId}/`;
let root: string;
let directory: string;
let packaged: string;
let output: PassThrough;
let printed: { text: string };
let previousInput: string | undefined;
const context = () => ({ directory, homeDirectory: root, platform: 'darwin' as const, output });
const install = () => runBrowserCli(['install', packaged, 'chrome', extensionId], context());
const wrapper = () => join(directory, 'browser-native-host');

beforeEach(async () => {
  ({ root, directory, packaged, output, printed } = await createBrowserFixture());
  previousInput = process.env.REMOTE_INPUT_ENABLED;
});

afterEach(() => cleanupBrowserFixture(root, previousInput));

it('installs an isolated native host with owner-only settings and a safely quoted stable wrapper', async () => {
  await install();
  const settings = JSON.parse(await readFile(join(directory, 'browser-settings.json'), 'utf8'));

  expect(settings.origins).toEqual([origin]);
  expect(settings.runtime.nodePath).toBe(join(packaged, 'runtime/node'));
  expect((await lstat(join(directory, 'browser-settings.json'))).mode & 0o777).toBe(0o600);
  expect((await lstat(wrapper())).mode & 0o777).toBe(0o700);
  await run(wrapper(), [origin]);

  expect(await readFile(join(directory, 'fixture-args'), 'utf8')).toBe(
    `${join(packaged, 'entry.mjs')}\nbrowser\nhost\n${origin}\n`,
  );

  await expect(install()).resolves.toBeUndefined();
});

it('rejects bad IDs and runtime traversal without partial settings or registration', async () => {
  await expect(runBrowserCli(['install', packaged, 'chrome', '*'], context())).rejects.toThrow(
    'INVALID_REQUEST',
  );

  const manifest = JSON.parse(await readFile(join(packaged, 'runtime-manifest.json'), 'utf8'));

  manifest.runtime.entryPath = '../escape.mjs';
  await writeFile(join(packaged, 'runtime-manifest.json'), JSON.stringify(manifest));
  await expect(install()).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  await expect(readFile(join(directory, 'browser-settings.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses unsafe or unrelated existing settings and wrapper content', async () => {
  await writeFile(join(directory, 'browser-settings.json'), '{"partial":true}', { mode: 0o600 });
  await expect(install()).rejects.toThrow();
  expect(await readFile(join(directory, 'browser-settings.json'), 'utf8')).toBe('{"partial":true}');
  await rm(join(directory, 'browser-settings.json'));
  await writeFile(wrapper(), 'unrelated', { mode: 0o700 });
  await expect(install()).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  expect(await readFile(wrapper(), 'utf8')).toBe('unrelated');
});

it('rejects a wrong host origin before exposing a bridge or starting a companion', async () => {
  await install();

  await expect(
    runBrowserCli(['host', 'chrome-extension://pppppppppppppppppppppppppppppppp/'], context()),
  ).rejects.toThrow('UNAUTHORIZED');
});

it('does not let a browser host claim the desktop grant origin', async () => {
  const { LocalOrigin } = await import('@protocol');

  await install();
  await expect(runBrowserCli(['host', LocalOrigin.Desktop], context())).rejects.toThrow('UNAUTHORIZED');
});

it('guards legacy hooks runtimes before calling the supervisor', async () => {
  await install();
  await writeFile(join(directory, 'hooks.sock'), 'synthetic legacy marker');
  let starts = 0;

  await expect(
    runBrowserCli(['host', origin], {
      ...context(),
      dependencies: {
        ensure: async () => {
          starts++;
        },
        bridge: async (_io, options) => {
          await options.beforeConnect?.();
        },
        probe: async () => null,
      },
    }),
  ).rejects.toThrow('LOCAL_COMPANION_MISMATCH');

  expect(starts).toBe(0);
});

it('routes host startup through the supervisor and preserves framed-only stdout', async () => {
  await install();
  printed.text = '';
  let starts = 0;

  await runBrowserCli(['host', origin], {
    ...context(),
    dependencies: {
      ensure: async (options) => {
        expect(options.runtime.entryPath).toBe(join(packaged, 'entry.mjs'));
        starts++;
      },
      bridge: async (_io, options) => {
        expect(options.origin).toBe(origin);
        await options.beforeConnect?.();
      },
      probe: async () => null,
    },
  });

  expect(starts).toBe(1);
  expect(printed.text).toBe('');
});

it('authorizes only the selected pending extension grant and revokes it without printing handles', async () => {
  await install();
  printed.text = '';
  const { database, grants, clientId } = await pendingGrant(directory, origin);

  await runBrowserCli(['authorize'], context());
  expect(printed.text).toContain(clientId);

  await expect(
    runBrowserCli(['authorize', clientId, 'pppppppppppppppppppppppppppppppp'], context()),
  ).rejects.toThrow('UNAUTHORIZED');

  await runBrowserCli(['authorize', clientId, extensionId], context());
  const principal = grants.connect(origin, clientId);

  expect(printed.text).not.toContain(principal.handle);
  await runBrowserCli(['revoke', clientId], context());
  expect(grants.current(principal)).toBe(false);
  database.close();
});

it('approves a pending desktop grant through the local admin command', async () => {
  const { grants, database, clientId } = await pendingGrant(directory, origin);

  expect(() => grants.connect(LocalOrigin.Desktop, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');

  await runBrowserCli(['authorize-desktop', clientId], context());

  expect(grants.current(grants.connect(LocalOrigin.Desktop, clientId))).toBe(true);
  database.close();
});

it('revokes a desktop grant without requiring Chrome browser settings', async () => {
  const { grants, database, clientId } = await pendingGrant(directory, LocalOrigin.Desktop);

  await runBrowserCli(['authorize-desktop', clientId], context());
  const principal = grants.connect(LocalOrigin.Desktop, clientId);

  await runBrowserCli(['revoke', clientId], context());

  expect(grants.current(principal)).toBe(false);
  database.close();
});

it('uninstalls only its product manifest and preserves state and neighboring files', async () => {
  await install();

  const manifest = join(
    root,
    'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agent_remote.companion.json',
  );

  await writeFile(join(manifest, '..', 'unrelated.json'), 'keep');
  await runBrowserCli(['uninstall', 'chrome'], context());
  await expect(readFile(manifest)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(manifest, '..', 'unrelated.json'), 'utf8')).toBe('keep');
  await expect(readFile(join(directory, 'browser-settings.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('starts injected local mode with input enabled and preserves explicit permission settings', async () => {
  let closed = false;
  let stop: (() => void) | undefined;

  await runBrowserCli(['start-local'], {
    ...context(),
    dependencies: {
      startDaemon: async () => {
        expect(process.env.REMOTE_INPUT_ENABLED).toBe('1');

        return {
          close: async () => {
            closed = true;
          },
        };
      },
      onShutdown: (callback) => {
        stop = callback;
      },
      probe: async () => null,
    },
  });

  stop?.();
  await new Promise((resolve) => setImmediate(resolve));
  expect(closed).toBe(true);
});

it.each([
  ['1', true],
  [undefined, false],
] as const)(
  'starts local mode with legacy Claude hooks only when the desktop launcher asks (%s)',
  async (flag, expected) => {
    vi.stubEnv(CompanionEnvironment.LegacyClaudeHooks, flag);
    const calls: unknown[] = [];

    try {
      await runBrowserCli(['start-local'], {
        ...context(),
        dependencies: {
          startDaemon: async (options) => {
            calls.push(options);

            return { close: async () => {} };
          },
          onShutdown: () => {},
          probe: async () => null,
        },
      });

      expect(calls).toEqual([{ legacyClaudeHooks: expected }]);
      expect(process.env[CompanionEnvironment.LegacyClaudeHooks]).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it.each([[], ['unknown'], ['host'], ['revoke', '*'], ['install']])(
  'rejects invalid browser arguments %j',
  async (...args) => {
    await expect(runBrowserCli(args as string[], context())).rejects.toThrow('INVALID_REQUEST');
  },
);
