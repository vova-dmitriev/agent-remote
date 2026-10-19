import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
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
import { AttachmentService } from '../apps/daemon/src/attachments/service.js';
import { ContextCheckpointManager } from '../apps/daemon/src/continuity/context/checkpoint.js';
import { createCodexCheckpointSource } from '../apps/daemon/src/continuity/source/native.js';
import type { RepositoryProbe } from '../apps/daemon/src/continuity/source/types.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root() {
  const path = await mkdtemp(join(tmpdir(), 'checkpoint-codex-source-'));

  roots.push(path);

  return path;
}

const attachments = {
  async prepare() {
    return [];
  },
} as unknown as AttachmentService;

const repositoryProbe: RepositoryProbe = async () => ({
  revision: 'b'.repeat(40),
  workingTree: 'git-visible-metadata-v1:0:fixture',
});

function session(): Session {
  return {
    id: 'native-session',
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

it('uses bounded Codex history pages and restores only selected local context', async () => {
  const directory = await root();
  const store = new LocalStore(':memory:', 'device-a');
  const current = session();

  const image: HistoryMessage['attachments'] = [
    {
      id: 'image-a',
      name: 'image.png',
      mimeType: 'image/png',
      byteLength: 3,
      sha256: 'a'.repeat(64),
      kind: 'image',
    },
  ];

  const messages: HistoryMessage[] = [
    { id: 'codex-user', role: MessageRole.User, text: 'inspect image', occurredAt: 1, attachments: image },
    { id: 'codex-assistant', role: MessageRole.Assistant, text: 'visible result', occurredAt: 2 },
  ];

  for (const message of messages) {
    store.append({
      sessionId: current.id,
      type: EventType.Message,
      payload: message,
      occurredAt: message.occurredAt,
    });
  }

  const source = createCodexCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-codex',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    store,
    attachments,
    repositoryProbe,
  });

  const fence = await source.captureFence();
  const latest = await source.page({ limit: 1, watermark: fence.historyWatermark });

  expect(latest.messages.map((message) => message.id)).toEqual(['codex-assistant']);
  expect(latest.nextAnchor).toMatch(/^cache:/u);

  const earlier = await source.page({
    limit: 1,
    watermark: fence.historyWatermark,
    anchor: latest.nextAnchor!,
  });

  expect(earlier.messages.map((message) => message.id)).toEqual(['codex-user']);

  const manager = new ContextCheckpointManager({
    directory: join(directory, 'checkpoints'),
    ownerId: 'owner-a',
  });

  const draft = await manager.prepareCheckpoint(source, {
    selectedMessageIds: ['codex-user', 'codex-assistant'],
    selectedAttachmentIds: ['image-a'],
    constraints: [],
  });

  const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, source);
  const restored = await manager.readCheckpoint(draft.id, summary.digest, source);

  expect(restored.body.messages[0]?.attachments[0]).toMatchObject({
    id: 'image-a',
    hash: null,
    status: 'missing',
  });

  expect(restored.body.messages.map((message) => message.id)).toEqual(['codex-user', 'codex-assistant']);
  store.close();
});
