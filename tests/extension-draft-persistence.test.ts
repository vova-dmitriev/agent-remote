import { expect, it } from 'vitest';
import { ErrorCode } from '../packages/protocol/src/index.js';
import type { ApplicationClient } from '../apps/mini-app/src/shared/api/application-client.js';
import { DraftState } from '../apps/mini-app/src/features/send-command/model/persistence/draft-state.js';

it('flushes the latest text with the acknowledged revision and blocks blind conflict retries', async () => {
  let saved = { revision: 3, text: 'existing', attachments: [] };
  const writes: { revision: number; text: string }[] = [];
  let reject = false;

  const persistence = {
    readDraft: async () => structuredClone(saved),
    saveDraft: async (_id: string, _generation: string, revision: number, text: string) => {
      writes.push({ revision, text });

      if (reject) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      saved = { revision: revision + 1, text, attachments: [] };

      return structuredClone(saved);
    },
  } as unknown as NonNullable<ApplicationClient['persistence']>;

  const draft = new DraftState(persistence, 'session', 'generation', () => true);

  expect(await draft.load()).toMatchObject({ revision: 3, text: 'existing' });
  draft.update('typed', []);
  await draft.flush();
  expect(saved).toEqual({ revision: 4, text: 'typed', attachments: [] });
  reject = true;
  draft.update('stale', []);
  await expect(draft.flush()).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);
  draft.update('still stale', []);
  await expect(draft.flush()).rejects.toThrow(ErrorCode.LOCAL_REVISION_CONFLICT);

  expect(writes).toEqual([
    { revision: 3, text: 'typed' },
    { revision: 4, text: 'stale' },
  ]);
});

it('retains a staged attachment reference when download fails so the user can retry or remove it', async () => {
  const { restoreAttachments } =
    await import('../apps/mini-app/src/features/send-command/model/persistence/restore-attachments.js');

  const descriptor = {
    id: '12345678-1234-4234-8234-123456789abc',
    name: 'hello.txt',
    mimeType: 'text/plain',
    byteLength: 5,
    kind: 'file' as const,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  };

  const signal = new AbortController().signal;

  const failed = await restoreAttachments(
    {
      download: async () => {
        throw new Error(ErrorCode.NETWORK_UNAVAILABLE);
      },
      upload: async () => {
        throw new Error('unused');
      },
    },
    'session',
    [descriptor],
    signal,
  );

  expect(failed[0]).toMatchObject({
    reference: descriptor,
    status: 'error',
    error: ErrorCode.NETWORK_UNAVAILABLE,
  });

  expect(failed[0]!.file.size).toBe(0);

  const restored = await restoreAttachments(
    {
      download: async () => new Blob(['hello']),
      upload: async () => {
        throw new Error('unused');
      },
    },
    'session',
    [descriptor],
    signal,
  );

  expect(restored[0]).toMatchObject({ descriptor, status: 'ready' });
  expect(await restored[0]!.file.text()).toBe('hello');
});
