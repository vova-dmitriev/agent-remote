import { expect, it } from 'vitest';
import { ErrorCode, ProfileOperationPhase, ProfileStatus } from '../packages/protocol/src/index.js';
import { authenticationFixture } from './profiles/authentication.fixture.js';

it('requires a newly authorized check after a delivered sign-in continues with its viewer closed', async () => {
  const f = authenticationFixture();
  let current = true;
  const started = await f.authentication.execute(f.request, () => current);

  expect(started.operation.phase).toBe(ProfileOperationPhase.AwaitingAuthentication);
  current = false;
  f.authorize();

  await expect(f.authentication.reconcile(f.request.operationId, () => current)).rejects.toThrow(
    ErrorCode.UNAUTHORIZED,
  );

  expect(f.service.registry.get(f.profile.id).status).toBe(ProfileStatus.NeedsAuthentication);
  expect(f.close).not.toHaveBeenCalled();
  const checked = await f.authentication.reconcile(f.request.operationId, () => true);

  expect(checked.phase).toBe(ProfileOperationPhase.Complete);
  expect(f.service.registry.get(f.profile.id).status).toBe(ProfileStatus.Ready);
  expect(f.close).toHaveBeenCalledOnce();
  await f.authentication.close();
});
