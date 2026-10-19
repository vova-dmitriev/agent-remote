import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  ErrorCode,
  ProfileAction,
  ProfileAuthMode,
  AgentProvider,
  ProfileRequestKind,
  type ProfileRequest,
  type ProfileResponse,
} from '@protocol';
import { ProfileOperationJournal } from '../apps/mini-app/src/pages/accounts/lib/management/operation-journal.js';
import { profileServiceFixture } from './profiles/service.fixture.js';

function memoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

it('persists only the uncertain ID, rejects another write and recovers its original receipt after reopening', async () => {
  const { service } = profileServiceFixture();
  const storage = memoryStorage();

  const request: ProfileRequest = {
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Create,
      operationId: randomUUID(),
      input: {
        provider: AgentProvider.Codex,
        authMode: ProfileAuthMode.ApiKey,
        label: 'Synthetic private label',
      },
    },
  };

  const journal = new ProfileOperationJournal('device-a', storage);

  await expect(
    journal.request(async () => {
      await service.execute(request.mutation);
      throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
    }, request),
  ).rejects.toThrow(ErrorCode.UNKNOWN_AFTER_WRITE);

  expect(storage.getItem(storage.key(0)!)).toBe(request.mutation.operationId);
  const reopened = new ProfileOperationJournal('device-a', storage);
  const unexpected = vi.fn<() => Promise<ProfileResponse>>();

  await expect(
    reopened.request(unexpected, {
      ...request,
      mutation: { ...request.mutation, operationId: randomUUID() },
    }),
  ).rejects.toThrow(ErrorCode.UNKNOWN_AFTER_WRITE);

  expect(unexpected).not.toHaveBeenCalled();

  await reopened.request(
    async () => ({
      kind: ProfileRequestKind.Reconcile,
      data: service.operation(request.mutation.operationId),
    }),
    {
      kind: ProfileRequestKind.Reconcile,
      operationId: request.mutation.operationId,
    },
  );

  expect(reopened.pending()).toBeNull();
  expect(service.list().profiles).toHaveLength(1);
});

it('fails before any effect when durable browser storage is unavailable', async () => {
  const storage = memoryStorage();

  storage.setItem = () => {
    throw new Error('synthetic unavailable storage');
  };

  const journal = new ProfileOperationJournal('device-a', storage);
  const send = vi.fn<() => Promise<ProfileResponse>>();

  await expect(
    journal.request(send, {
      kind: ProfileRequestKind.Authenticate,
      input: {
        action: ProfileAction.SignIn,
        operationId: randomUUID(),
        profileId: randomUUID(),
        expectedVersion: 1,
      },
    }),
  ).rejects.toThrow('synthetic unavailable storage');

  expect(send).not.toHaveBeenCalled();
});
