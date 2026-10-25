import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PERSONAL_SERVICE_LABEL,
  PersonalServiceAction,
  personalServicePaths,
  personalServicePlist,
  runPersonalService,
} from '@daemon/cli/personal/personal-service.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A launchctl that records its calls and knows the service as loaded or not. */
function control(loaded: boolean) {
  const calls: string[][] = [];

  return {
    calls,
    run: async (args: string[]) => {
      calls.push(args);

      if (args[0] === 'print' && !loaded) {
        throw new Error('synthetic: not loaded');
      }
    },
  };
}

async function home() {
  const directory = await mkdtemp(join(tmpdir(), 'personal-service-'));

  directories.push(directory);

  return directory;
}

it('writes a login agent that keeps remote personal running from the installation, with escaped paths', () => {
  const plist = personalServicePlist({
    root: '/synthetic/a&b',
    node: '/bin/node',
    path: '/bin',
    log: '/logs/p.log',
  });

  expect(plist).toContain(`<string>${PERSONAL_SERVICE_LABEL}</string>`);

  expect(plist).toContain(
    '<string>/bin/node</string><string>/synthetic/a&amp;b/apps/daemon/bin/remote.mjs</string><string>personal</string>',
  );

  expect(plist).toContain('<key>KeepAlive</key><true/>');
  expect(plist).toContain('<key>RunAtLoad</key><true/>');
  expect(plist).not.toContain('a&b');
});

it('installs by replacing a loaded agent, then loads the new one', async () => {
  const directory = await home();
  const launchctl = control(true);

  await runPersonalService(PersonalServiceAction.Install, {
    root: '/synthetic/root',
    home: directory,
    control: launchctl.run,
    platform: 'darwin',
  });

  const { plist } = personalServicePaths(directory);

  expect(await readFile(plist, 'utf8')).toContain('/synthetic/root/apps/daemon/bin/remote.mjs');
  expect((await stat(plist)).mode & 0o777).toBe(0o644);
  expect(launchctl.calls.map(([verb]) => verb)).toEqual(['print', 'bootout', 'bootstrap']);
  expect(launchctl.calls[2]?.[2]).toBe(plist);
});

it('starts a stopped agent by loading it, and restarts a running one in place', async () => {
  const directory = await home();

  await runPersonalService(PersonalServiceAction.Install, {
    root: '/synthetic/root',
    home: directory,
    control: control(false).run,
    platform: 'darwin',
  });

  const stopped = control(false);
  const running = control(true);

  await runPersonalService(PersonalServiceAction.Start, {
    home: directory,
    control: stopped.run,
    platform: 'darwin',
  });

  await runPersonalService(PersonalServiceAction.Restart, {
    home: directory,
    control: running.run,
    platform: 'darwin',
  });

  expect(stopped.calls.map(([verb]) => verb)).toEqual(['print', 'bootstrap']);
  expect(running.calls[1]?.slice(0, 2)).toEqual(['kickstart', '-k']);
});

it('refuses to start an agent that was never installed, and refuses other systems', async () => {
  const directory = await home();

  await expect(
    runPersonalService(PersonalServiceAction.Start, {
      home: directory,
      control: control(false).run,
      platform: 'darwin',
    }),
  ).rejects.toThrow('PERSONAL_SERVICE_NOT_INSTALLED');

  await expect(runPersonalService(PersonalServiceAction.Start, { platform: 'linux' })).rejects.toThrow(
    'PERSONAL_SERVICE_UNSUPPORTED',
  );
});
