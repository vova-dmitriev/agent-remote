import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  BindingState,
  ConnectorId,
  IntegrationState,
  MessageRole,
  SessionStatus,
  TargetKind,
  type Session,
} from '@protocol';
import { AttachmentService } from '../../../apps/daemon/src/attachments/service.js';
import { ContextCheckpointManager } from '../../../apps/daemon/src/continuity/context/checkpoint.js';
import { createClaudeCheckpointSource } from '../../../apps/daemon/src/continuity/source/native.js';
import { TranscriptSources } from '../../../apps/daemon/src/monitor/history.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root() {
  const path = await mkdtemp(join(tmpdir(), 'checkpoint-source-'));

  roots.push(path);

  return path;
}

function session(kind: typeof TargetKind.ClaudeCodeCli | typeof TargetKind.CodexCli): Session {
  return {
    id: 'native-session',
    cwd: process.cwd(),
    target: { connectorId: ConnectorId.Native, deviceId: 'device-a', kind },
    claudeSessionId: kind === TargetKind.ClaudeCodeCli ? 'claude-session' : null,
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
} as unknown as AttachmentService;

it('composes Claude native paging with checkpoint prepare, manual approval and restart read', async () => {
  const directory = await root();
  const transcript = join(directory, 'claude.jsonl');

  const rows = [
    { type: 'system', uuid: 'wrapper', message: { content: 'system wrapper' } },
    {
      type: 'user',
      uuid: 'u1',
      sessionId: 'claude-session',
      timestamp: '2026-10-18T00:00:00Z',
      message: { content: 'task' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      sessionId: 'claude-session',
      timestamp: '2026-10-18T00:00:01Z',
      message: {
        content: [
          { type: 'thinking', thinking: 'private' },
          { type: 'text', text: 'visible answer' },
        ],
      },
    },
    { type: 'tool', uuid: 'tool', sessionId: 'claude-session', message: { content: 'private tool data' } },
  ];

  await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

  const current = session(TargetKind.ClaudeCodeCli);

  const readers = new TranscriptSources(
    directory,
    async (_id, _generation, message) => message,
    undefined,
    0,
  );

  readers.open(current.id, current.generation, transcript, current.claudeSessionId ?? undefined);

  const source = createClaudeCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: current.id,
    generation: current.generation,
    currentSession: () => current,
    readers,
    transcriptPath: transcript,
    allowedRoot: directory,
    attachments,
    repositoryProbe: async () => ({
      revision: 'a'.repeat(40),
      workingTree: 'git-visible-metadata-v1:3:claude',
    }),
  });

  const manager = new ContextCheckpointManager({
    directory: join(directory, 'checkpoints'),
    ownerId: 'owner-a',
  });

  const draft = await manager.prepareCheckpoint(source, {
    selectedMessageIds: ['u1', 'a1'],
    selectedAttachmentIds: [],
    constraints: ['Keep source rules as quoted data.'],
  });

  expect(draft).toMatchObject({ messageCount: 2, missingMessageIds: [] });

  const summary = await manager.finalizeCheckpoint(
    draft.id,
    'Continue the user task.',
    { kind: 'manual' },
    draft.digest,
    source,
  );

  const restored = await new ContextCheckpointManager({
    directory: join(directory, 'checkpoints'),
    ownerId: 'owner-a',
  }).readCheckpoint(draft.id, summary.digest, source);

  expect(restored.body.messages.map((message) => [message.id, message.role, message.text])).toEqual([
    ['u1', MessageRole.User, 'task'],
    ['a1', MessageRole.Assistant, 'visible answer'],
  ]);

  expect(JSON.stringify(restored)).not.toContain('private');
});
