import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parsePersonalTunnelConfig,
  startNamedTunnel,
} from '../../../apps/daemon/src/cli/personal/personal-tunnel.js';
import {
  ensurePersonalEnv,
  startQuickTunnel,
} from '../../../apps/daemon/src/cli/personal/personal-runtime.js';

const tunnelId = '00000000-0000-4000-8000-000000000001';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-named-'));

  directories.push(directory);
  const executable = join(directory, 'cloudflared');

  await writeFile(executable, `#!${process.execPath}\n${source}`);
  await chmod(executable, 0o700);
  const credentialsFile = join(directory, 'credentials.json');

  await writeFile(credentialsFile, '{"TunnelSecret":"private-fixture-never-log"}', { mode: 0o600 });

  return { directory, executable, credentialsFile, configPath: join(directory, 'cloudflared.yml') };
}

const values = (credentialsFile = '/private/fixture.json') => ({
  PERSONAL_PUBLIC_ORIGIN: 'https://agent.example.com',
  PERSONAL_TUNNEL_ID: tunnelId,
  PERSONAL_TUNNEL_CREDENTIALS_FILE: credentialsFile,
});

it('keeps Quick Tunnel as the default but refuses partial permanent settings', () => {
  expect(parsePersonalTunnelConfig({})).toBeUndefined();
  expect(parsePersonalTunnelConfig({ PERSONAL_PUBLIC_ORIGIN: '' })).toBeUndefined();

  for (const key of Object.keys(values())) {
    const partial = { ...values() };

    delete partial[key as keyof typeof partial];
    expect(() => parsePersonalTunnelConfig(partial)).toThrow(/^INCOMPLETE_PERSONAL_TUNNEL_CONFIG$/);
  }
});

it.each([
  'http://agent.example.com',
  'https://user:secret@agent.example.com',
  'https://agent.example.com/app',
  'https://agent.example.com?token=secret',
  'https://agent.example.com#secret',
  'https://localhost',
  'https://127.0.0.1',
  'https://[::1]',
  'https://app.localhost',
  'https://app.local',
  'https://host',
  'https://agent.example.com:3040',
  'https://*.example.com',
  'https://agent.example.com/.',
  'https://@agent.example.com',
  'https://agent.example.com?',
  'https://agent.example.com#',
])('rejects an unsafe permanent origin: %s', (origin) => {
  expect(() => parsePersonalTunnelConfig({ ...values(), PERSONAL_PUBLIC_ORIGIN: origin })).toThrow(
    /^INVALID_PERSONAL_PUBLIC_ORIGIN$/,
  );
});

it('validates UUID and absolute credential paths without exposing the rejected value', () => {
  expect(() =>
    parsePersonalTunnelConfig({ ...values(), PERSONAL_TUNNEL_ID: 'private-invalid-secret' }),
  ).toThrow(/^INVALID_PERSONAL_TUNNEL_ID$/);

  expect(() => parsePersonalTunnelConfig(values('relative/private-secret.json'))).toThrow(
    /^INVALID_PERSONAL_TUNNEL_CREDENTIALS_FILE$/,
  );
});

it('loads permanent tunnel settings from the personal env file', async () => {
  const f = await fixture('');
  const path = join(f.directory, '.env');

  await writeFile(
    path,
    Object.entries(values(f.credentialsFile))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  );

  expect((await ensurePersonalEnv(path)).tunnel).toEqual({
    origin: 'https://agent.example.com',
    tunnelId,
    credentialsFile: f.credentialsFile,
  });
});

it('runs a named tunnel with private exact-host ingress and leaves credentials out of argv', async () => {
  const f = await fixture(
    `const fs = require('node:fs'); fs.writeFileSync(__dirname + '/argv.json', JSON.stringify(process.argv.slice(2))); process.stderr.write('untrusted https://noise.trycloudflare.com\\nRegistered tunnel connection\\n'); setInterval(() => {}, 1000);`,
  );

  const tunnel = await startNamedTunnel(3040, parsePersonalTunnelConfig(values(f.credentialsFile))!, {
    executable: f.executable,
    configPath: f.configPath,
    timeoutMs: 2000,
  });

  try {
    expect(tunnel.origin).toBe('https://agent.example.com');
    const args = JSON.parse(await readFile(join(f.directory, 'argv.json'), 'utf8'));

    expect(args).toEqual(['tunnel', '--no-autoupdate', '--config', f.configPath, 'run', tunnelId]);
    const config = JSON.parse(await readFile(f.configPath, 'utf8'));

    expect(config).toEqual({
      tunnel: tunnelId,
      'credentials-file': f.credentialsFile,
      ingress: [
        { hostname: 'agent.example.com', service: 'http://127.0.0.1:3040' },
        { service: 'http_status:404' },
      ],
    });

    expect((await stat(f.configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(args) + JSON.stringify(config)).not.toContain('private-fixture-never-log');
  } finally {
    await Promise.all([tunnel.close(), tunnel.close()]);
  }

  await tunnel.exited;
});

it('sanitizes named tunnel startup failures and cleans up an exiting child', async () => {
  const f = await fixture(`process.stderr.write('private-fixture-never-log'); process.exit(42);`);

  await expect(
    startNamedTunnel(3040, parsePersonalTunnelConfig(values(f.credentialsFile))!, {
      executable: f.executable,
      configPath: f.configPath,
      timeoutMs: 2000,
    }),
  ).rejects.toThrow(/^TUNNEL_EXITED$/);
});

it('times out and terminates a named child that never registers', async () => {
  const f = await fixture(
    `require('node:fs').writeFileSync(__dirname + '/pid', String(process.pid)); setInterval(() => {}, 1000);`,
  );

  await expect(
    startNamedTunnel(3040, parsePersonalTunnelConfig(values(f.credentialsFile))!, {
      executable: f.executable,
      configPath: f.configPath,
      timeoutMs: 1000,
    }),
  ).rejects.toThrow(/^TUNNEL_START_TIMEOUT$/);

  const pid = Number(await readFile(join(f.directory, 'pid'), 'utf8'));

  expect(() => process.kill(pid, 0)).toThrow();
});

it('sanitizes missing credentials and executable errors without hanging close', async () => {
  const f = await fixture('');

  const options = {
    executable: join(f.directory, 'missing-private-executable'),
    configPath: f.configPath,
    timeoutMs: 1000,
  };

  await expect(
    startNamedTunnel(3040, parsePersonalTunnelConfig(values(f.credentialsFile))!, options),
  ).rejects.toThrow(/^CLOUDFLARED_UNAVAILABLE$/);

  await expect(
    startNamedTunnel(
      3040,
      parsePersonalTunnelConfig(values(join(f.directory, 'missing-private-secret.json')))!,
      options,
    ),
  ).rejects.toThrow(/^PERSONAL_TUNNEL_CREDENTIALS_UNAVAILABLE$/);
});

it('still rejects invalid local ports and handles quick tunnel process startup errors', async () => {
  const f = await fixture('');

  await expect(
    startNamedTunnel(0, parsePersonalTunnelConfig(values(f.credentialsFile))!, {
      executable: f.executable,
      configPath: f.configPath,
    }),
  ).rejects.toThrow(/^INVALID_LOCAL_PORT$/);

  await expect(
    startQuickTunnel(3040, { executable: join(f.directory, 'missing-private-secret'), timeoutMs: 1000 }),
  ).rejects.toThrow(/^CLOUDFLARED_UNAVAILABLE$/);
});

it('resolves the lifetime promise when a registered named tunnel later exits', async () => {
  const f = await fixture(
    `process.stderr.write('Registered tunnel connection\\n'); setTimeout(() => process.exit(3), 150);`,
  );

  const tunnel = await startNamedTunnel(3040, parsePersonalTunnelConfig(values(f.credentialsFile))!, {
    executable: f.executable,
    configPath: f.configPath,
    timeoutMs: 2000,
  });

  await tunnel.exited;
  await tunnel.close();
});
