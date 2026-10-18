import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerNativeHost, unregisterNativeHost } from '../apps/daemon/src/browser/registration/index.js';
import { BrowserKind } from '../packages/protocol/src/values/local-client.js';

let homeDirectory: string;
let executablePath: string;
const allowedOrigins = ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'];

const options = () => ({
  browserKind: BrowserKind.Chrome,
  homeDirectory,
  executablePath,
  allowedOrigins,
  platform: 'darwin' as const,
});

const manifestPath = () =>
  join(
    homeDirectory,
    'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agent_remote.companion.json',
  );

beforeEach(async () => {
  homeDirectory = await realpath(await mkdtemp(join(tmpdir(), 'native host ')));
  executablePath = join(homeDirectory, 'Agent Remote.app', 'Contents', 'MacOS', 'bridge');
  await mkdir(join(homeDirectory, 'Agent Remote.app', 'Contents', 'MacOS'), { recursive: true, mode: 0o700 });
  await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
});

afterEach(() => rm(homeDirectory, { recursive: true, force: true }));

it('writes an owner-only native manifest with an absolute spaced executable path', async () => {
  const result = await registerNativeHost(options());

  expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual({
    name: 'com.agent_remote.companion',
    description: 'Agent Remote companion',
    path: executablePath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  });

  expect((await lstat(result.manifestPath)).mode & 0o777).toBe(0o600);
  expect(await readdir(join(result.manifestPath, '..'))).toEqual(['com.agent_remote.companion.json']);
});

it.each([
  [BrowserKind.Chrome, 'Google/Chrome'],
  [BrowserKind.Chromium, 'Chromium'],
  [BrowserKind.ChromeForTesting, 'Google/ChromeForTesting'],
])('registers %s in its actual browser-specific macOS directory', async (browserKind, directory) => {
  const result = await registerNativeHost({ ...options(), browserKind });

  expect(result.manifestPath).toBe(
    join(
      homeDirectory,
      'Library/Application Support',
      directory,
      'NativeMessagingHosts/com.agent_remote.companion.json',
    ),
  );
});

it.each(
  [
    [],
    ['chrome-extension://*/'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/path'],
    ['https://abcdefghijklmnopabcdefghijklmnop/'],
    ['chrome-extension://qrstuvwxyzabcdefqrstuvwxyzabcdef/'],
  ].map((origins) => [origins] as const),
)('rejects non-exact or invalid origins %j', async (origins) => {
  await expect(registerNativeHost({ ...options(), allowedOrigins: origins })).rejects.toThrow(/origin/i);
  await expect(lstat(manifestPath())).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects duplicate origins and unsupported platforms without creating a manifest', async () => {
  await expect(
    registerNativeHost({ ...options(), allowedOrigins: [...allowedOrigins, ...allowedOrigins] }),
  ).rejects.toThrow(/origin/i);

  await expect(registerNativeHost({ ...options(), platform: 'linux' })).rejects.toThrow(/platform/i);

  await expect(
    registerNativeHost({ ...options(), browserKind: 'other' as typeof BrowserKind.Chrome }),
  ).rejects.toThrow(/browser/i);

  await expect(lstat(manifestPath())).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects relative, non-executable and unsafe executables', async () => {
  await expect(registerNativeHost({ ...options(), executablePath: 'bridge' })).rejects.toThrow(/absolute/i);

  await expect(
    registerNativeHost({ ...options(), executablePath: `${executablePath}/../bridge` }),
  ).rejects.toThrow(/canonical/i);

  await expect(registerNativeHost({ ...options(), homeDirectory: `${homeDirectory}/..` })).rejects.toThrow(
    /canonical/i,
  );

  await chmod(executablePath, 0o600);
  await expect(registerNativeHost(options())).rejects.toThrow(/executable/i);
  await chmod(executablePath, 0o001);
  await expect(registerNativeHost(options())).rejects.toThrow(/executable/i);
  await chmod(executablePath, 0o722);
  await expect(registerNativeHost(options())).rejects.toThrow(/unsafe/i);
});

it('rejects symlink executables and unsafe executable parents', async () => {
  const linked = join(homeDirectory, 'linked');

  await symlink(executablePath, linked);
  await expect(registerNativeHost({ ...options(), executablePath: linked })).rejects.toThrow(/symlink/i);
  await chmod(join(executablePath, '..'), 0o777);
  await expect(registerNativeHost(options())).rejects.toThrow(/unsafe/i);
});

it('rejects symlinked registration parent without modifying its target', async () => {
  const elsewhere = join(homeDirectory, 'elsewhere');

  await mkdir(elsewhere);
  await symlink(elsewhere, join(homeDirectory, 'Library'));
  await expect(registerNativeHost(options())).rejects.toThrow(/symlink/i);
  expect(await readdir(elsewhere)).toEqual([]);
});

it('rejects unsafe registration parents', async () => {
  await mkdir(join(homeDirectory, 'Library'), { mode: 0o777 });
  await chmod(join(homeDirectory, 'Library'), 0o777);
  await expect(registerNativeHost(options())).rejects.toThrow(/unsafe/i);
});

it('does not overwrite an unrelated existing manifest', async () => {
  await mkdir(join(manifestPath(), '..'), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath(), '{"name":"unrelated"}', { mode: 0o600 });
  await expect(registerNativeHost(options())).rejects.toThrow(/existing|owned/i);
  expect(await readFile(manifestPath(), 'utf8')).toBe('{"name":"unrelated"}');
});

it('accepts its matching registration and rejects tampered executable or origins', async () => {
  await registerNativeHost(options());
  await expect(registerNativeHost(options())).resolves.toEqual({ manifestPath: manifestPath() });
  const original = JSON.parse(await readFile(manifestPath(), 'utf8'));

  await writeFile(manifestPath(), JSON.stringify({ ...original, path: '/unrelated' }));
  await expect(registerNativeHost(options())).rejects.toThrow(/existing|owned/i);
  await expect(unregisterNativeHost(options())).rejects.toThrow(/existing|owned/i);

  await writeFile(
    manifestPath(),
    JSON.stringify({
      ...original,
      allowed_origins: ['chrome-extension://pppppppppppppppppppppppppppppppp/'],
    }),
  );

  await expect(registerNativeHost(options())).rejects.toThrow(/existing|owned/i);
});

it('rejects symlinked or unsafe manifests on install and uninstall', async () => {
  await registerNativeHost(options());
  const target = join(homeDirectory, 'keep.json');

  await writeFile(target, 'keep', { mode: 0o600 });
  await rm(manifestPath());
  await symlink(target, manifestPath());
  await expect(registerNativeHost(options())).rejects.toThrow(/symlink/i);
  await expect(unregisterNativeHost(options())).rejects.toThrow(/symlink/i);
  expect(await readFile(target, 'utf8')).toBe('keep');
  await rm(manifestPath());
  await writeFile(manifestPath(), 'untrusted', { mode: 0o666 });
  await chmod(manifestPath(), 0o666);
  await expect(registerNativeHost(options())).rejects.toThrow(/unsafe/i);
});

it('uninstalls only the matching product manifest and preserves neighboring files', async () => {
  await registerNativeHost(options());
  const unrelated = join(manifestPath(), '..', 'unrelated.json');

  await writeFile(unrelated, 'keep');
  expect(await unregisterNativeHost(options())).toBe(true);
  expect(await readFile(unrelated, 'utf8')).toBe('keep');
  expect(await unregisterNativeHost(options())).toBe(false);
});
