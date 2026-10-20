import { expect, it } from 'vitest';
import { afterEach } from 'vitest';
import {
  BindingState,
  ConnectorId,
  EventType,
  IntegrationState,
  MessageRole,
  SessionStatus,
  TargetKind,
  type HistoryMessage,
  type Session,
} from '@protocol';
import { createCodexCheckpointSource } from '@daemon/continuity/source/native.js';
import type { RepositoryProbe, RepositoryWorkingTreeIdentity } from '@daemon/continuity/source/types.js';
import { ContextCheckpointManager } from '@daemon/continuity/context/checkpoint.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { checkpointRoot, cleanCheckpointRoots } from '../../helpers/sessions/checkpoint-fixtures.js';

afterEach(cleanCheckpointRoots);

function createSession(): Session {
  return {
    id: 'session-a',
    cwd: process.cwd(),
    target: { connectorId: ConnectorId.Native, deviceId: 'device-a', kind: TargetKind.CodexCli },
    claudeSessionId: null,
    generation: 'generation-a',
    status: SessionStatus.Idle,
    binding: BindingState.Verified,
    lastEventAt: 1,
    capabilities: { observe: true, history: true, prompt: true, interrupt: true, createSession: false },
    integrationState: IntegrationState.Ready,
  } as Session;
}

const attachments = {
  async prepare() {
    return [];
  },
};

const repositoryProbe: RepositoryProbe = async () => ({
  revision: 'c'.repeat(40),
  workingTree: 'git-visible-metadata-v1:0:fixture',
});

it('rejects a Codex page if the native history watermark advances after capture', async () => {
  const store = new LocalStore(':memory:', 'device-a');
  const current = createSession();

  const source = createCodexCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    store,
    attachments,
    repositoryProbe,
  });

  const message: HistoryMessage = {
    id: 'message-a',
    role: MessageRole.User,
    text: 'before append',
    occurredAt: 1,
  };

  store.append({ sessionId: current.id, type: EventType.Message, payload: message, occurredAt: 1 });
  const fence = await source.captureFence();

  const appended: HistoryMessage = {
    id: 'message-b',
    role: MessageRole.User,
    text: 'after append',
    occurredAt: 2,
  };

  store.append({ sessionId: current.id, type: EventType.Message, payload: appended, occurredAt: 2 });

  await expect(source.page({ limit: 30, watermark: fence.historyWatermark })).rejects.toThrow(
    'CHECKPOINT_SOURCE_HISTORY_UNAVAILABLE',
  );

  store.close();
});

it('fences generation changes and blocks active writers before paging', async () => {
  const store = new LocalStore(':memory:', 'device-a');
  let current = createSession();

  const source = createCodexCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    store,
    attachments,
    repositoryProbe,
  });

  await source.captureFence();
  current = { ...current, generation: 'generation-b' };
  await expect(source.captureFence()).rejects.toThrow('CHECKPOINT_SOURCE_BINDING_INVALID');

  current = { ...createSession(), status: SessionStatus.Running };

  expect(() =>
    createCodexCheckpointSource({
      ownerId: 'owner-a',
      deviceId: 'device-a',
      executionId: 'execution-a',
      sessionId: current.id,
      generation: current.generation,
      currentSession: () => current,
      store,
      attachments,
      repositoryProbe,
    }),
  ).toThrow('CHECKPOINT_SOURCE_BUSY');

  store.close();
});

it('rejects use after the repository working-tree identity changes', async () => {
  const directory = await checkpointRoot('checkpoint-source-');
  const store = new LocalStore(':memory:', 'device-a');
  const current = createSession();
  let workingTree: RepositoryWorkingTreeIdentity = 'git-visible-metadata-v1:0:before';

  const source = createCodexCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    store,
    attachments,
    repositoryProbe: async () => ({ revision: 'd'.repeat(40), workingTree }),
  });

  const message: HistoryMessage = { id: 'message-a', role: MessageRole.User, text: 'task', occurredAt: 1 };

  store.append({ sessionId: current.id, type: EventType.Message, payload: message, occurredAt: 1 });
  const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

  const draft = await manager.prepareCheckpoint(source, {
    selectedMessageIds: ['message-a'],
    selectedAttachmentIds: [],
    constraints: [],
  });

  const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, source);

  workingTree = 'git-visible-metadata-v1:0:after-edit';

  await expect(manager.readCheckpoint(draft.id, summary.digest, source)).rejects.toThrow(
    'CHECKPOINT_SOURCE_CHANGED',
  );

  store.close();
});
