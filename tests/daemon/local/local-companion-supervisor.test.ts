import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fixture,
  hash,
  createPackageFixture,
  stopFixture,
  probeAt,
  waitForFixture,
} from '../../helpers/companion-fixture.js';
import { ensureCompanion } from '../../../apps/daemon/src/local/supervisor/index.js';
import { CompanionEnvironment } from '../../../apps/daemon/src/local/supervisor/values.js';

const run = promisify(execFile);
let directory: string;
let nodePath: string;
let nodeSha256: string;
let entryPath: string;

beforeAll(async () => {
  nodePath = await realpath(process.execPath);
  nodeSha256 = hash(await readFile(nodePath));
});

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'companion ')));
  entryPath = join(directory, 'trusted entry.mjs');
  await writeFile(entryPath, fixture, { mode: 0o600 });
});

afterEach(async () => {
  await stopFixture(directory);
  await rm(directory, { recursive: true, force: true });
});

const runtime = () => ({ nodePath, nodeSha256, entryPath, entrySha256: hash(fixture) });

const probe = () => probeAt(directory);

const options = () => ({ directory, runtime: runtime(), probe, timeoutMs: 2000 });

it('starts the exact trusted runtime with fixed args and a private home', async () => {
  await ensureCompanion(options());
  expect(await readFile(join(directory, 'starts'), 'utf8')).toBe('["browser","start-local"]\n');
});

it.each([
  [true, '1'],
  [false, ''],
] as const)(
  'passes the legacy Claude hook request to the launched companion only on demand (%s)',
  async (legacyClaudeHooks, expected) => {
    const previous = process.env[CompanionEnvironment.LegacyClaudeHooks];

    process.env[CompanionEnvironment.LegacyClaudeHooks] = '1';

    try {
      await ensureCompanion({ ...options(), legacyClaudeHooks });
    } finally {
      if (previous === undefined) {
        delete process.env[CompanionEnvironment.LegacyClaudeHooks];
      } else {
        process.env[CompanionEnvironment.LegacyClaudeHooks] = previous;
      }
    }

    expect(await readFile(join(directory, 'legacy-claude-hooks'), 'utf8')).toBe(expected);
  },
);

it('attaches to a compatible companion without launching or validating absent runtime resources', async () => {
  await ensureCompanion({
    ...options(),
    runtime: { ...runtime(), nodePath: '/missing' },
    probe: async () => ({ protocolVersion: 1, instanceId: 'existing' }),
  });

  await expect(readFile(join(directory, 'starts'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects protocol mismatch without starting or replacing the existing companion', async () => {
  await expect(
    ensureCompanion({ ...options(), probe: async () => ({ protocolVersion: 2, instanceId: 'existing' }) }),
  ).rejects.toThrow('LOCAL_COMPANION_MISMATCH');

  await expect(readFile(join(directory, 'starts'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('serializes concurrent starts and probes again after acquiring the lock', async () => {
  await Promise.all([ensureCompanion(options()), ensureCompanion(options()), ensureCompanion(options())]);
  expect((await readFile(join(directory, 'starts'), 'utf8')).trim().split('\n')).toHaveLength(1);
});

it.each(['nodeSha256', 'entrySha256'] as const)('rejects tampering against %s', async (key) => {
  await expect(
    ensureCompanion({ ...options(), runtime: { ...runtime(), [key]: '0'.repeat(64) } }),
  ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

  await expect(readFile(join(directory, 'starts'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects relative paths, symlink entrypoints and writable runtime resources', async () => {
  await expect(
    ensureCompanion({ ...options(), runtime: { ...runtime(), nodePath: 'node' } }),
  ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

  const linked = join(directory, 'linked.mjs');

  await symlink(entryPath, linked);

  await expect(
    ensureCompanion({ ...options(), runtime: { ...runtime(), entryPath: linked } }),
  ).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');

  await chmod(entryPath, 0o666);
  await expect(ensureCompanion(options())).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
});

it('rejects symlink or unsafe installation directories without launching', async () => {
  const link = join(directory, 'linked home');

  await symlink(directory, link);
  await expect(ensureCompanion({ ...options(), directory: link })).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  await chmod(directory, 0o777);
  await expect(ensureCompanion(options())).rejects.toThrow('LOCAL_RUNTIME_UNTRUSTED');
  await chmod(directory, 0o700);
});

it('does not steal a stale ambiguous lock or delete its contents', async () => {
  const lock = join(directory, 'companion-start.lock');

  await writeFile(lock, 'stale ambiguous owned lock', { mode: 0o600 });
  await expect(ensureCompanion({ ...options(), timeoutMs: 60 })).rejects.toThrow('LOCAL_COMPANION_TIMEOUT');
  expect(await readFile(lock, 'utf8')).toBe('stale ambiguous owned lock');
});

it('bounds startup timeout and never automatically retries or terminates the child', async () => {
  await expect(ensureCompanion({ ...options(), probe: async () => null, timeoutMs: 500 })).rejects.toThrow(
    'LOCAL_COMPANION_TIMEOUT',
  );

  expect((await waitForFixture(join(directory, 'starts'))).trim().split('\n')).toHaveLength(1);
  const pulse = await waitForFixture(join(directory, 'pulse'));

  expect(await waitForFixture(join(directory, 'pulse'), pulse)).not.toBe(pulse);
});

it('keeps the synthetic child alive after its launching parent exits', async () => {
  const module = new URL('../../../apps/daemon/src/local/supervisor/index.ts', import.meta.url).href;
  const script = `import {ensureCompanion} from ${JSON.stringify(module)}; import {readFile} from 'node:fs/promises'; const options=${JSON.stringify({ directory, runtime: runtime(), timeoutMs: 2000 })}; options.probe=async()=>{try{await readFile(${JSON.stringify(join(directory, 'ready'))});return {protocolVersion:1,instanceId:'fixture'};}catch{return null;}}; await ensureCompanion(options);`;

  await run(nodePath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    timeout: 5000,
  });

  const first = await waitForFixture(join(directory, 'pulse'));

  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(await readFile(join(directory, 'pulse'), 'utf8')).not.toBe(first);
});

it('packages a standalone Node runtime and production dependency closure without private source files', async () => {
  const { sourceDirectory, outputDirectory } = await createPackageFixture(directory);
  const module = new URL('../../../scripts/extension/package-companion.mjs', import.meta.url).href;

  await run(
    nodePath,
    [
      '--input-type=module',
      '-e',
      `import {packageCompanion} from ${JSON.stringify(module)};await packageCompanion(${JSON.stringify({ sourceDirectory, outputDirectory, nodePath })});`,
    ],
    { timeout: 10_000 },
  );

  const manifest = JSON.parse(await readFile(join(outputDirectory, 'runtime-manifest.json'), 'utf8'));

  const packaged = await run(
    join(outputDirectory, manifest.runtime.nodePath),
    [join(outputDirectory, manifest.runtime.entryPath)],
    { env: { PATH: '' } },
  );

  expect(packaged.stdout).toBe('packaged synthetic');

  expect(manifest.runtime.nodeSha256).toBe(
    hash(await readFile(join(outputDirectory, manifest.runtime.nodePath))),
  );

  expect(manifest.runtime.entrySha256).toBe(
    hash(await readFile(join(outputDirectory, manifest.runtime.entryPath))),
  );

  await expect(readFile(join(outputDirectory, 'private.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('serializes first startup when concurrent callers must create the private installation directory', async () => {
  const home = join(directory, 'new private home');
  const settings = { ...options(), directory: home, probe: () => probeAt(home) };

  try {
    await Promise.all([ensureCompanion(settings), ensureCompanion(settings), ensureCompanion(settings)]);
    expect((await readFile(join(home, 'starts'), 'utf8')).trim().split('\n')).toHaveLength(1);
  } finally {
    await stopFixture(home);
  }
});
