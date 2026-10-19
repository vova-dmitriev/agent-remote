import { beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { compileCompanionFixture, packagedCompanionFixture } from './helpers/packaged-companion.js';
import { guardRuntimeProcesses } from './helpers/runtime-processes.js';

const run = promisify(execFile);

beforeAll(compileCompanionFixture, 30_000);
guardRuntimeProcesses();

it('starts and probes the relocated bundled daemon without development Node/PATH or a helper override', async () => {
  const fixture = await packagedCompanionFixture();

  try {
    const code = `
import {startDaemon} from './dist/apps/daemon/src/main.js';
import {BridgeClient,installationRoot} from './dist/apps/daemon/src/desktop/bridge-client.js';
import {localClientSecret} from './dist/apps/daemon/src/local/bootstrap/identity.js';
import {probeCompanion} from './dist/apps/daemon/src/local/bootstrap/probe.js';
import {join} from 'node:path';
if(installationRoot()!==process.cwd())throw new Error('PACKAGED_ROOT_ESCAPE');
if(process.env.CLAUDE_REMOTE_HELPER)throw new Error('HELPER_OVERRIDE_NOT_ALLOWED');
const daemon=await startDaemon();
const bridge=new BridgeClient();
try{
const result=await bridge.request({operation:'synthetic-empty'});
if(!Array.isArray(result)||result.length)throw new Error('FIXTURE_HELPER_INVALID');
const health=await probeCompanion(join(process.env.CLAUDE_REMOTE_HOME,'client.sock'),await localClientSecret(process.env.CLAUDE_REMOTE_HOME));
if(!health||health.protocolVersion!==1)throw new Error('PACKAGED_HEALTH_INVALID');
process.stdout.write('PACKAGED_COMPANION_STARTED_AND_PROBED\\n');
}finally{bridge.close();await daemon.close();}
`;

    const result = await run(join(fixture.artifact, 'runtime/node'), ['--input-type=module', '-e', code], {
      cwd: fixture.artifact,
      env: fixture.environment,
      timeout: 15_000,
    });

    expect(result.stdout.trim()).toBe('PACKAGED_COMPANION_STARTED_AND_PROBED');
    const manifest = JSON.parse(await readFile(join(fixture.artifact, 'runtime-manifest.json'), 'utf8'));

    expect(manifest.helper.path).toBe('artifacts/ClaudeRemoteBridge.app/Contents/MacOS/ClaudeBridge');

    expect(manifest.helper.sha256).toBe(
      createHash('sha256')
        .update(await readFile(join(fixture.artifact, manifest.helper.path)))
        .digest('hex'),
    );

    const state = JSON.parse(await readFile(join(fixture.state, 'local-identity.json'), 'utf8'));

    expect(state.ownerId).toMatch(/^local:/);
  } finally {
    await fixture.close();
  }
}, 30_000);

it('refuses a helper bundle writable by another account', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'helper-')));

  try {
    const source = join(root, 'source');
    const bundle = join(source, 'artifacts/ClaudeRemoteBridge.app');

    await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
    await writeFile(join(bundle, 'Contents/MacOS/ClaudeBridge'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await chmod(bundle, 0o777);

    const module = await import(
      new URL('../scripts/extension/companion-dependencies.mjs', import.meta.url).href
    );

    await expect(module.copyCompanionHelper(source, join(root, 'output'))).rejects.toThrow(
      'Unsafe companion helper bundle',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
