import { expect, it } from 'vitest';
import {
  ErrorCode,
  CommandActionType,
  ConnectionStatus,
  serverFrameSchema,
  type ClientCommand,
} from '../packages/protocol/src/index.js';
import type { ApplicationClient } from '../apps/mini-app/src/shared/api/application-client.js';
import { DraftState } from '../apps/mini-app/src/features/send-command/model/persistence/draft-state.js';
import { ManagedQueue } from '../apps/mini-app/src/features/send-command/model/persistence/managed-queue.js';
import { createSessionStore } from '../apps/mini-app/src/entities/session/model/store/create-session-store.js';
import { snapshotFrame } from './extension-client.fixture.js';

function draftFixture() {
  let saved = { revision: 1, text: 'before restart', attachments: [] };
  const writes: string[] = [];

  const persistence = {
    readDraft: async () => structuredClone(saved),
    saveDraft: async (_session: string, _generation: string, revision: number, text: string) => {
      if (revision !== saved.revision) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      writes.push(text);
      saved = { revision: revision + 1, text, attachments: [] };

      return structuredClone(saved);
    },
  } as unknown as NonNullable<ApplicationClient['persistence']>;

  return {
    persistence,
    writes,
    remote: (text: string) => {
      saved = { revision: saved.revision + 1, text, attachments: [] };
    },
  };
}

it('waits for the post-reconnect draft revision before saving new typing', async () => {
  const f = draftFixture();
  const draft = new DraftState(f.persistence, 'a', 'generation-a', () => true);

  await draft.load();
  f.remote('');
  const reconnected = draft.reconcile();

  draft.update('after restart', []);
  await Promise.all([reconnected, draft.flush()]);
  expect(f.writes).toEqual(['after restart']);
});

it('does not overwrite another viewer draft while reconciling a reconnect', async () => {
  const f = draftFixture();
  const draft = new DraftState(f.persistence, 'a', 'generation-a', () => true);

  await draft.load();
  f.remote('acknowledged in another viewer');
  await expect(draft.reconcile()).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);
  draft.update('local text', []);
  await expect(draft.flush()).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);
  expect(f.writes).toEqual([]);
});

it('refreshes the companion queue before appending after a worker restart', async () => {
  const store = createSessionStore();
  const frame = serverFrameSchema.parse(snapshotFrame());

  if (!('snapshot' in frame)) {
    throw new Error('snapshot required');
  }

  const session = frame.snapshot.sessions[0]!;

  const command: ClientCommand = {
    commandId: 'before',
    target: session.target,
    sessionId: 'a',
    generation: session.generation,
    action: { type: CommandActionType.Prompt, text: 'before' },
  };

  let queue = { revision: 1, intents: [command] };

  const persistence = {
    readQueue: async () => structuredClone(queue),
    readReceipt: async () => null,
    saveQueue: async (_id: string, _generation: string, revision: number, intents: ClientCommand[]) => {
      if (revision !== queue.revision) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      queue = { revision: revision + 1, intents };

      return structuredClone(queue);
    },
  } as unknown as NonNullable<ApplicationClient['persistence']>;

  store.getState().runtime.attach({ persistence } as ApplicationClient);
  store.getState().setConnection(ConnectionStatus.Online);
  store.getState().receiveFrame(frame);
  const managed = new ManagedQueue(store);

  await managed.refresh('a');
  queue = { revision: 2, intents: [] };
  const next = { ...command, commandId: 'after', action: { type: CommandActionType.Prompt, text: 'after' } };

  await expect(
    managed.enqueue({ command: next, files: [], streamId: 'stream', runtimeEpoch: 1 }),
  ).resolves.toBe(true);

  expect(queue.intents.map((item) => item.commandId)).toEqual(['after']);
  managed.close();
});
