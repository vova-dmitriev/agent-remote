import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { authenticationFixture } from './profiles/authentication.fixture.js';

it('replaces an obsolete authentication process without allowing its late callback to close the new login', async () => {
  const f = authenticationFixture();
  let opened!: () => void;
  let release!: () => void;

  const opening = new Promise<void>((resolve) => {
    opened = resolve;
  });

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = {
    loginSubscription: vi.fn(async () => ({
      loginId: 'first',
      authUrl: 'https://auth.openai.com/authorize?state=first',
    })),
    probe: f.probe,
    close: vi.fn(async () => {}),
  };

  const second = {
    loginSubscription: vi.fn(async () => ({
      loginId: 'second',
      authUrl: 'https://auth.openai.com/authorize?state=second',
    })),
    probe: f.probe,
    close: vi.fn(async () => {}),
  };

  f.open.mockImplementationOnce(async () => {
    opened();
    await held;

    return first;
  });

  f.open.mockImplementationOnce(async () => second);
  const old = f.authentication.execute(f.request);

  await opening;
  const current = f.service.registry.get(f.profile.id);

  const replacement = f.authentication.execute({
    ...f.request,
    operationId: randomUUID(),
    expectedVersion: current.version,
  });

  release();
  const [oldResult, nextResult] = await Promise.all([old, replacement]);

  expect(oldResult.operation).toMatchObject({ phase: 'failed', code: 'LOCAL_REVISION_CONFLICT' });
  expect(nextResult.operation.phase).toBe('awaiting_authentication');
  expect(nextResult.login?.loginId).toBe('second');
  expect(first.loginSubscription).not.toHaveBeenCalled();
  expect(first.close).toHaveBeenCalledOnce();
  expect(second.close).not.toHaveBeenCalled();
  await f.authentication.close();
  expect(second.close).toHaveBeenCalledOnce();
});
