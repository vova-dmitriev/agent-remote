import { describe, expect, it } from 'vitest';
import {
  ConnectionStatus,
  ErrorCode,
  CommandActionType,
  CommandStatus,
  type CommandResult,
  type ClientCommand,
  serverFrameSchema,
} from '@protocol';
import { createSessionStore } from '@/entities/session/model/store/create-session-store.js';
import type { ApplicationClient } from '@/shared/api/application-client.js';
import { snapshotFrame } from '../../extension/client/extension-client.fixture.js';
import { ManagedQueue } from '@/features/send-command/model/persistence/managed-queue.js';

function fixture() {
  const store = createSessionStore();
  let queue = { revision: 0, intents: [] as ClientCommand[] };
  let acknowledge: (() => void) | undefined;
  let rejectSave: Error | undefined;
  let receipt: CommandResult | null = null;
  let loseAcknowledgement = false;

  const persistence: NonNullable<ApplicationClient['persistence']> = {
    readDraft: async () => ({ revision: 0, text: '', attachments: [] }),
    saveDraft: async () => ({ revision: 1, text: '', attachments: [] }),
    readQueue: async () => structuredClone(queue),
    saveQueue: async (_session, _generation, revision, intents) => {
      await new Promise<void>((resolve) => {
        acknowledge = resolve;
      });

      if (rejectSave) {
        throw rejectSave;
      }

      if (revision !== queue.revision) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      queue = { revision: revision + 1, intents: structuredClone(intents) };

      if (loseAcknowledgement) {
        throw new Error(ErrorCode.NETWORK_UNAVAILABLE);
      }

      return structuredClone(queue);
    },
    readReceipt: async () => receipt,
  };

  const client = { persistence } as ApplicationClient;

  store.getState().runtime.attach(client);
  store.getState().setConnection(ConnectionStatus.Online);
  store.getState().receiveFrame(serverFrameSchema.parse(snapshotFrame()));
  const session = store.getState().session.snapshot!.sessions[0]!;

  const command: ClientCommand = {
    commandId: 'draft-command',
    target: session.target,
    sessionId: session.id,
    generation: session.generation,
    action: { type: CommandActionType.Prompt, text: 'Persist me' },
  };

  const managed = new ManagedQueue(store);

  return {
    store,
    managed,
    command,
    acknowledge: () => acknowledge?.(),
    loseAcknowledgement: () => {
      loseAcknowledgement = true;
    },
    receipt: (value: CommandResult) => {
      receipt = value;
    },
    conflict: () => {
      rejectSave = new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
    },
  };
}

describe('companion managed viewer queue', () => {
  it('publishes queued prompts only after companion acknowledgement', async () => {
    const f = fixture();
    const pending = f.managed.enqueue({ command: f.command, files: [], streamId: 'stream', runtimeEpoch: 1 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.store.getState().outbox).toEqual([]);
    f.acknowledge();
    await pending;

    expect(f.store.getState().outbox.map((item) => item.command.action)).toEqual([
      { type: CommandActionType.Prompt, text: 'Persist me' },
    ]);

    f.managed.close();
  });

  it('keeps local queued state unchanged when cancellation conflicts', async () => {
    const f = fixture();
    const pending = f.managed.enqueue({ command: f.command, files: [], streamId: 'stream', runtimeEpoch: 1 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    f.acknowledge();
    await pending;
    f.conflict();
    const cancelled = f.managed.cancel(f.command.commandId);
    const rejected = expect(cancelled).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.store.getState().outbox).toHaveLength(1);
    f.acknowledge();
    await rejected;
    expect(f.store.getState().outbox).toHaveLength(1);
    f.managed.close();
  });
});

it('restores acknowledged queued work without replaying accepted or unknown operations', async () => {
  const f = fixture();
  const pending = f.managed.enqueue({ command: f.command, files: [], streamId: 'stream', runtimeEpoch: 1 });

  await new Promise((resolve) => setTimeout(resolve, 0));
  f.acknowledge();
  await pending;
  f.store.setState({ outbox: [] });
  f.receipt({ commandId: f.command.commandId, status: CommandStatus.Unknown });
  await f.managed.refresh('a');
  expect(f.store.getState().outbox[0]?.status).toBe('unknown');
  f.receipt({ commandId: f.command.commandId, status: CommandStatus.Dispatched });
  await f.managed.refresh('a');
  expect(f.store.getState().outbox).toEqual([]);
  f.managed.close();
});

it('queries an unconfirmed queue write before a repeated submit instead of duplicating the prompt', async () => {
  const f = fixture();

  f.loseAcknowledgement();
  const first = f.managed.enqueue({ command: f.command, files: [], streamId: 'stream', runtimeEpoch: 1 });
  const rejected = expect(first).rejects.toThrow(ErrorCode.NETWORK_UNAVAILABLE);

  await new Promise((resolve) => setTimeout(resolve, 0));
  f.acknowledge();
  await rejected;

  await expect(
    f.managed.enqueue({
      command: { ...f.command, commandId: 'new-button-press' },
      files: [],
      streamId: 'stream',
      runtimeEpoch: 1,
    }),
  ).resolves.toBe(true);

  expect(f.store.getState().outbox.map((item) => item.command.commandId)).toEqual(['draft-command']);
  f.managed.close();
});
