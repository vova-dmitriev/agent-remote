import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { CodexManager } from '@daemon/runtime/services/codex-manager.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { Monitor } from '@daemon/monitor/monitor.js';
import { AdapterRegistry } from '@daemon/adapters/registry.js';
import { PermissionBroker } from '@daemon/commands/permission-broker.js';
import { profileExecutionNamespace } from '@daemon/sessions/execution/namespace.js';
import type { ProfiledExecutionLaunch } from '@daemon/sessions/execution/types.js';
import { executionProfile, executionSelection } from '../../../helpers/execution-profile.js';
import { executionProfileSummarySchema } from '@protocol';
import { ManagedCodexLaunchEvidenceType } from '@daemon/codex/launch/types.js';

const connectSocket = vi.hoisted(() => vi.fn());
const launcher = vi.hoisted(() => ({ ensure: vi.fn(), exited: vi.fn() }));
const native = vi.hoisted(() => ({ identity: vi.fn(), models: vi.fn() }));

vi.mock('@daemon/codex/rpc/transport.js', () => ({ connectCodexSocket: connectSocket }));

vi.mock('@daemon/codex/launcher.js', () => ({
  ensureManagedCodexSocket: launcher.ensure,
  managedCodexSocketExited: launcher.exited,
  managedCodexChildState: launcher.exited,
}));

vi.mock('@daemon/profiles/native/metadata.js', () => ({
  nativeProfileIdentity: native.identity,
}));

vi.mock('@daemon/profiles/native/models.js', () => ({
  nativeProfileModels: native.models,
}));

it('launches a profiled Codex thread in its isolated runtime and verifies the selected identity and model', async () => {
  const stateDirectory = '/synthetic/default-state';
  const namespaceRoot = await mkdtemp('/tmp/ar-test-');
  const profile = executionProfileSummarySchema.parse(executionProfile());
  const namespace = await profileExecutionNamespace(profile, namespaceRoot);
  const calls: { method: string; params: unknown }[] = [];
  let created = false;

  const thread = {
    id: 'profile-thread',
    cwd: '/synthetic/project',
    model: 'synthetic-model',
    reasoningEffort: 'high',
    canAcceptDirectInput: true,
    status: { type: 'idle' },
    turns: [],
  };

  const rpc = Object.assign(new EventEmitter(), {
    async request(method: string, params: unknown) {
      calls.push({ method, params });

      if (method === 'thread/loaded/list') {
        return { data: created ? [thread.id] : [] };
      }

      if (method === 'thread/start') {
        created = true;

        return { thread, model: 'synthetic-model', reasoningEffort: 'high' };
      }

      if (method === 'thread/read' || method === 'thread/resume') {
        return { thread, model: 'synthetic-model' };
      }

      return { data: [], nextCursor: null };
    },
    respond() {},
    async close() {},
  });

  launcher.ensure.mockImplementation(async (directory: string, _executable: string, options: unknown) => {
    expect(directory).toBe(namespace.directory);

    expect(options).toMatchObject({
      environment: { HOME: '/synthetic/profile-home', CODEX_HOME: '/synthetic/profile-codex' },
      prefixArguments: expect.arrayContaining(['cli_auth_credentials_store="file"']),
    });

    (options as { onEvidence?: (evidence: unknown) => void }).onEvidence?.({
      type: ManagedCodexLaunchEvidenceType.ChildCreated,
      pid: 90001,
    });

    return namespace.socketPath;
  });

  launcher.exited.mockResolvedValue(false);

  connectSocket.mockImplementation(async (path: string) => {
    if (path !== namespace.socketPath || path === stateDirectory + '/codex/app-server.sock') {
      throw new Error('CODEX_DISCONNECTED');
    }

    return rpc;
  });

  native.identity.mockResolvedValue({ accountRef: profile.identity!.accountRef });
  native.models.mockResolvedValue([{ id: 'synthetic-model', efforts: ['medium', 'high'] }]);

  const store = new LocalStore(':memory:', 'device');
  const adapters = new AdapterRegistry('device');
  const permissions = new PermissionBroker();

  const monitor = new Monitor({
    deviceId: 'device',
    store,
    adapters,
    permissions,
    allowSessionCreation: true,
  });

  const manager = new CodexManager({
    stateDirectory,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: false,
    executionNamespaceRoot: namespaceRoot,
  });

  const executionLease = {
    id: 'execution-ref',
    bindSocket: vi.fn(),
    bindProcess: vi.fn(),
    processId: vi.fn(() => 90001),
    markReady: vi.fn(),
    releaseBeforeLaunch: vi.fn(),
    releaseAfterExit: vi.fn(),
  };

  const launch = {
    profile,
    selection: executionSelection(),
    environment: { HOME: '/synthetic/profile-home', CODEX_HOME: '/synthetic/profile-codex' },
    assertCurrent: vi.fn(),
    executionLease,
  } as unknown as ProfiledExecutionLaunch;

  try {
    await manager.start();
    const sessionId = await manager.createSession('/synthetic/project', launch);

    expect(monitor.session(sessionId)).toMatchObject({
      cwd: '/synthetic/project',
      target: { kind: 'codex-cli', threadId: 'profile-thread' },
      binding: 'verified',
      integrationState: 'ready',
    });

    expect(executionLease.bindSocket).toHaveBeenCalledWith(namespace.socketPath);
    expect(executionLease.markReady).toHaveBeenCalledOnce();
    expect(native.identity).toHaveBeenCalledWith(rpc, '/synthetic/profile-codex', 'subscription', false);

    expect(calls.find((call) => call.method === 'thread/start')?.params).toEqual({
      cwd: '/synthetic/project',
      model: 'synthetic-model',
      config: { model_reasoning_effort: 'high' },
    });
  } finally {
    await manager.close();
    expect(executionLease.releaseAfterExit).not.toHaveBeenCalled();
    permissions.close();
    store.close();
    await rm(namespaceRoot, { recursive: true, force: true });
  }
});
