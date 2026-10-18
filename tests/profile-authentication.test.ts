import { expect, it } from 'vitest';
import { ProfileAuthentication } from '../apps/daemon/src/profiles/authentication/service.js';
import { codexSubscription, verifiedAccount } from './profiles/registry.fixture.js';
import { authenticationFixture as fixture } from './profiles/authentication.fixture.js';

it('persists a sign-in operation and reuses its transient URL without another native login', async () => {
  const f = fixture();
  const pending = await f.authentication.execute(f.request);

  expect(pending.operation.phase).toBe('awaiting_authentication');
  expect(pending.login?.authUrl).toContain('https://auth.openai.com/');
  expect(await f.authentication.execute(f.request)).toEqual(pending);
  expect(f.loginSubscription).toHaveBeenCalledOnce();
  expect(f.authentication.operation(f.request.operationId)).not.toHaveProperty('login');

  expect(f.service.list().operations).toMatchObject([
    { id: f.request.operationId, phase: 'awaiting_authentication' },
  ]);

  f.authorize();
  const complete = await f.authentication.reconcile(f.request.operationId);

  expect(complete.phase).toBe('complete');
  expect(f.service.registry.get(f.profile.id).status).toBe('ready');
  expect(f.close).toHaveBeenCalledOnce();
});

it('recovers a sign-in after process restart by checking private native evidence without logging in again', async () => {
  const f = fixture();

  await f.authentication.execute(f.request);
  await f.authentication.close();
  f.authorize();
  const reopened = new ProfileAuthentication(f.configuration);

  expect((await reopened.reconcile(f.request.operationId)).phase).toBe('complete');
  expect(f.loginSubscription).toHaveBeenCalledOnce();
  await reopened.close();
});

it('does not start authentication after its caller is revoked while opening the native process', async () => {
  const f = fixture();
  let current = true;
  const original = f.open.getMockImplementation()!;

  f.open.mockImplementation(async () => {
    current = false;

    return original();
  });

  await expect(f.authentication.execute(f.request, () => current)).rejects.toThrow(/^UNAUTHORIZED$/);
  expect(f.loginSubscription).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});

it('never activates a profile disabled while native verification is pending', async () => {
  const f = fixture();

  await f.authentication.execute(f.request);

  f.probe.mockImplementation(async () => {
    const profile = f.service.registry.get(f.profile.id);

    f.service.registry.update(profile.id, profile.version, { enabled: false });

    return verifiedAccount();
  });

  const operation = await f.authentication.reconcile(f.request.operationId);

  expect(operation.phase).toBe('failed');
  expect(operation.code).toBe('LOCAL_REVISION_CONFLICT');
  expect(f.service.registry.get(f.profile.id).status).toBe('disabled');
  expect(f.close).toHaveBeenCalledOnce();
});

it('invalidates stale Ready metadata on failed authentication checks and redacts unknown native errors', async () => {
  const f = fixture();
  const ready = f.service.registry.verify(f.profile.id, 1, verifiedAccount());

  f.probe.mockRejectedValue(new Error('synthetic-private-token-in-unsafe-error'));

  const result = await f.authentication.execute({
    ...f.request,
    action: 'check_profile',
    expectedVersion: ready.version,
  });

  expect(result.operation).toMatchObject({ phase: 'failed', code: 'REQUEST_FAILED' });
  expect(f.service.registry.get(f.profile.id).status).toBe('needs_authentication');
  expect(JSON.stringify(result)).not.toContain('synthetic-private-token');
});

it('fails closed for unsupported Claude subscription isolation before spawning a native process', async () => {
  const f = fixture();
  const claude = f.service.registry.create({ ...codexSubscription, provider: 'claude' });

  await expect(f.authentication.execute({ ...f.request, profileId: claude.id })).rejects.toThrow(
    /^CAPABILITY_UNAVAILABLE$/,
  );

  expect(f.open).not.toHaveBeenCalled();
});

it('rejects a mismatched injected registry scope before reading native account data', async () => {
  const f = fixture();

  const foreign = new ProfileAuthentication({
    ...f.configuration,
    scope: { ownerId: 'foreign', deviceId: 'mac-a' },
  });

  await expect(foreign.execute(f.request)).rejects.toThrow(/^NOT_FOUND$/);
  expect(f.open).not.toHaveBeenCalled();
  await foreign.close();
});
