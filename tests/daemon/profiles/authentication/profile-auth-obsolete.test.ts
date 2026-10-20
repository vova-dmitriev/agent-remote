import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ErrorCode, ProfileOperationPhase } from '@protocol';
import { authenticationFixture } from '../fixtures/authentication.fixture.js';

it('does not leave a delivered sign-in pending after a replacement sign-in completes', async () => {
  const f = authenticationFixture();

  await f.authentication.execute(f.request);
  const profile = f.service.registry.get(f.profile.id);
  const replacement = { ...f.request, operationId: randomUUID(), expectedVersion: profile.version };

  await f.authentication.execute(replacement);
  f.authorize();
  await f.authentication.reconcile(replacement.operationId);
  expect(f.service.list().operations).toHaveLength(0);

  expect(f.authentication.operation(f.request.operationId)).toMatchObject({
    phase: ProfileOperationPhase.Failed,
    code: ErrorCode.LOCAL_REVISION_CONFLICT,
  });

  await f.authentication.close();
});
