import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProvider, ProfileAuthMode } from '@protocol';
import { CodexManager } from '../apps/daemon/src/runtime/services/codex-manager.js';
import { LocalDatabase } from '../apps/daemon/src/local/state/database.js';
import { ProfileService } from '../apps/daemon/src/profiles/service.js';
import { RuntimeProfiles } from '../apps/daemon/src/runtime/services/runtime-profiles.js';
import { profileHomes } from '../apps/daemon/src/profiles/environment/paths.js';
import { ProfileRuntimeFile } from '../apps/daemon/src/profiles/environment/values.js';
import { profileExecutionNamespace } from '../apps/daemon/src/sessions/execution/namespace.js';
import { ProfileIdentityPrefix } from '../apps/daemon/src/profiles/native/values.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { writeControlledCodexPeer } from './helpers/profile-codex-peer.js';

const directories: string[] = [];

export async function cleanupProfileLaunchFixtures() {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function setupPeer(scenario = 'normal') {
  const root = await mkdtemp(join(tmpdir(), 'p-'));

  directories.push(root);
  const database = new LocalDatabase(':memory:');
  const scope = { ownerId: 'owner-test', deviceId: 'device-test' };

  const runtime = new RuntimeProfiles({
    database,
    directory: join(root, 'profiles'),
    scope,
    inputEnabled: true,
    baseEnvironment: { PATH: process.env.PATH },
    native: { executable: process.execPath },
  });

  const internals = runtime as unknown as {
    service: ProfileService;
    native: { verify: (profile: Record<string, unknown>, current: () => boolean) => Promise<unknown> };
  };

  const registry = internals.service.registry;
  const email = scenario === 'identity_mismatch' ? 'wrong@example.test' : 'profile@example.test';
  const workspace = 'workspace-' + scenario;

  const model =
    scenario === 'model_mismatch' || scenario === 'effort_mismatch' ? 'model-requested' : 'model-' + scenario;

  const efforts: ('low' | 'high')[] = ['low', 'high'];

  const profile = registry.create({
    provider: AgentProvider.Codex,
    authMode: ProfileAuthMode.Subscription,
    label: scenario,
  });

  const accountRef =
    ProfileIdentityPrefix.Account + createHash('sha256').update('profile@example.test').digest('hex');

  const verified = registry.verify(profile.id, profile.version, {
    provider: AgentProvider.Codex,
    authMode: ProfileAuthMode.Subscription,
    identity: { accountRef, workspaceRef: workspace, verifiedAt: Date.now() },
    capabilities: {
      isolation: 'supported',
      createSession: true,
      contextSeed: true,
      resume: false,
      quota: false,
    },
    models: [{ id: model, efforts }],
  });

  const namespace = await profileExecutionNamespace(verified, '/tmp');

  directories.push(namespace.directory);
  const homes = await profileHomes(join(root, 'profiles'), verified, profile.id);

  await mkdir(homes.codex, { recursive: true, mode: 0o700 });

  await writeFile(
    join(homes.codex, ProfileRuntimeFile.CodexCredentials),
    JSON.stringify({
      tokens: { account_id: workspace },
      email,
      models: [{ id: model, efforts }],
      scenario,
      ...(scenario === 'model_mismatch' ? { actualModel: 'unexpected-model' } : {}),
      ...(scenario === 'effort_mismatch' ? { actualEffort: 'low' } : {}),
    }),
    { mode: 0o600 },
  );

  internals.native.verify = async (summary, current) => {
    if (!current()) {
      throw new Error('UNAUTHORIZED');
    }

    return {
      provider: summary.provider,
      authMode: summary.authMode,
      identity: summary.identity,
      capabilities: summary.capabilities,
      models: summary.models,
    };
  };

  const script = await writeControlledCodexPeer(root, createRequire(import.meta.url).resolve('ws'));
  const store = new LocalStore(':memory:', scope.deviceId);
  const adapters = new AdapterRegistry(scope.deviceId);
  const permissions = new PermissionBroker();

  const monitor = new Monitor({
    deviceId: scope.deviceId,
    store,
    adapters,
    permissions,
    allowSessionCreation: true,
  });

  const manager = new CodexManager({
    stateDirectory: join(root, 'state'),
    codexHome: join(root, 'default-codex'),
    codexExecutable: process.execPath,
    codexPrefixArguments: [script],
    executionNamespaceRoot: '/tmp',
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
  });

  return {
    root,
    database,
    runtime,
    registry,
    profile: verified,
    namespace,
    manager,
    monitor,
    store,
    permissions,
    scenario,
    workspace,
    model,
    efforts,
    homes,
  };
}

export async function create(
  fixture: Awaited<ReturnType<typeof setupPeer>>,
  model = fixture.model,
  effort: 'low' | 'high' = 'high',
) {
  const launch = await fixture.runtime.prepareExecution(
    {
      profileId: fixture.profile.id,
      provider: AgentProvider.Codex,
      model,
      effort,
    },
    fixture.profile.version,
  );

  return {
    sessionId: await fixture.manager.createSession(fixture.root, launch),
    launch,
    namespace: fixture.namespace,
  };
}
