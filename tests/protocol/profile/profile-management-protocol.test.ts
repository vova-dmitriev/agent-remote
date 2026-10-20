import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { profileMutationSchema, profileOperationSchema } from '@protocol';
import { codexSubscription } from '../../daemon/profiles/fixtures/registry.fixture.js';

it('accepts only owned actions and bounded safe metadata for profile lifecycle', () => {
  const request = { operationId: randomUUID(), action: 'create_profile', input: codexSubscription };

  expect(profileMutationSchema.parse(request)).toEqual(request);

  for (const key of ['apiKey', 'token', 'env', 'runtimeHome', 'executable', 'ownerId']) {
    expect(profileMutationSchema.safeParse({ ...request, [key]: 'synthetic-private' }).success).toBe(false);

    expect(
      profileMutationSchema.safeParse({
        ...request,
        input: { ...codexSubscription, [key]: 'synthetic-private' },
      }).success,
    ).toBe(false);
  }

  expect(profileMutationSchema.safeParse({ ...request, action: 'execute_arbitrary_command' }).success).toBe(
    false,
  );

  expect(
    profileMutationSchema.safeParse({
      operationId: randomUUID(),
      action: 'rename_profile',
      profileId: randomUUID(),
      expectedVersion: 0,
      label: 'Invalid revision',
    }).success,
  ).toBe(false);

  expect(
    profileOperationSchema.safeParse({ id: randomUUID(), phase: 'complete', apiKey: 'synthetic-private' })
      .success,
  ).toBe(false);
});
