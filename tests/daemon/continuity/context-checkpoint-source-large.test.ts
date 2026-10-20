import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  BindingState,
  ConnectorId,
  IntegrationState,
  SessionStatus,
  TargetKind,
  type Session,
} from '@protocol';
import { createClaudeCheckpointSource } from '@daemon/continuity/source/native.js';
import { TranscriptSources } from '@daemon/monitor/history.js';
import { AttachmentService } from '@daemon/attachments/service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('uses the bounded native page window for a transcript larger than the history window', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'checkpoint-large-native-'));

  roots.push(directory);
  const transcriptPath = join(directory, 'large.jsonl');
  const prefix = JSON.stringify({ type: 'api-request-blob', data: 'x'.repeat(33 * 1024 * 1024) }) + '\n';

  const history = Array.from(
    { length: 100 },
    (_, index) =>
      JSON.stringify({
        type: index % 2 ? 'assistant' : 'user',
        sessionId: 'claude-session',
        uuid: 'message-' + index,
        timestamp: new Date(index + 1).toISOString(),
        message: { content: 'synthetic ' + index },
      }) + '\n',
  ).join('');

  await writeFile(transcriptPath, prefix + history);

  const session = {
    id: 'native-session',
    cwd: process.cwd(),
    target: { connectorId: ConnectorId.Native, deviceId: 'device-a', kind: TargetKind.ClaudeCodeCli },
    claudeSessionId: 'claude-session',
    generation: 'generation-a',
    status: SessionStatus.Idle,
    binding: BindingState.Verified,
    lastEventAt: 1,
    capabilities: { observe: true, history: true, prompt: true, interrupt: true, createSession: false },
    integrationState: IntegrationState.Ready,
  } as Session;

  let transformed = 0;

  const readers = new TranscriptSources(
    directory,
    async (_id, _generation, message) => {
      transformed++;

      return message;
    },
    undefined,
    0,
  );

  readers.open(session.id, session.generation, transcriptPath, session.claudeSessionId ?? undefined);

  const source = createClaudeCheckpointSource({
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    sessionId: session.id,
    generation: session.generation,
    currentSession: () => session,
    readers,
    transcriptPath,
    allowedRoot: directory,
    attachments: {
      async prepare() {
        return [];
      },
    } as unknown as AttachmentService,
    repositoryProbe: async () => ({
      revision: 'e'.repeat(40),
      workingTree: 'git-visible-metadata-v1:3:large',
    }),
  });

  const page = await source.page({ limit: 30, watermark: (await source.captureFence()).historyWatermark });

  expect(page.messages).toHaveLength(30);
  expect(page.messages[0]?.id).toBe('message-70');
  expect(page.messages.at(-1)?.id).toBe('message-99');
  expect(page.hasMore).toBe(true);
  expect(transformed).toBeLessThanOrEqual(100);
});
