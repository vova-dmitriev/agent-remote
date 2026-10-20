import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CredentialEnrollmentService } from '../../../../apps/daemon/src/profiles/enrollment/service.js';
import { CredentialEnrollmentLimits, ErrorCode, ProfileOperationPhase } from '@protocol';
import { enrollmentFixture } from '../fixtures/enrollment.fixture.js';

it('terminalizes an unused expired challenge so recovery no longer blocks further changes', async () => {
  const f = await enrollmentFixture();

  await f.enrollment.begin(f.request);
  f.setTime(1000 + CredentialEnrollmentLimits.LifetimeMs);
  const result = await f.enrollment.reconcile(f.request.operationId);

  expect(result).toMatchObject({ phase: ProfileOperationPhase.Failed, code: ErrorCode.ENROLLMENT_EXPIRED });
  expect(f.service.list().operations).toHaveLength(0);
  expect(existsSync(f.credential)).toBe(false);
});

it('reconciles an uncertain native enrollment from its fingerprint without repeating login', async () => {
  const f = await enrollmentFixture();

  f.interrupt();
  const envelope = await f.seal();
  const unknown = await f.enrollment.complete(envelope);

  expect(unknown.phase).toBe('unknown');
  expect(unknown.code).toBe('UNKNOWN_AFTER_WRITE');
  const restarted = new CredentialEnrollmentService(f.configuration);
  const reconciled = await restarted.reconcile(f.request.operationId);

  expect(reconciled.phase).toBe('complete');
  expect(f.service.registry.get(f.profile.id).status).toBe('ready');
  expect(readFileSync(f.calls, 'utf8')).toBe('native login\n');
  expect(await restarted.complete(envelope)).toEqual(reconciled);
});

it('does not consume or apply a credential after the caller was revoked', async () => {
  const f = await enrollmentFixture();
  const envelope = await f.seal();

  await expect(f.enrollment.complete(envelope, () => false)).rejects.toThrow('UNAUTHORIZED');
  expect(f.enrollment.operation(f.request.operationId).phase).toBe('awaiting_authentication');
  expect(existsSync(f.credential)).toBe(false);
});

it('coalesces concurrent completion of one envelope before its native login finishes', async () => {
  const f = await enrollmentFixture();
  let release!: () => void;
  let started!: () => void;

  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });

  const service = new CredentialEnrollmentService({
    ...f.configuration,
    apply: async (key) => {
      started();
      await barrier;

      return f.configuration.apply(key);
    },
  });

  const envelope = await f.seal();
  const results = Promise.allSettled([service.complete(envelope), service.complete(envelope)]);

  await entered;
  release();
  const completed = await results;

  expect(completed.every((item) => item.status === 'fulfilled')).toBe(true);

  for (const item of completed) {
    if (item.status === 'fulfilled') {
      expect(['preparing', 'complete']).toContain(item.value.phase);
    }
  }

  expect(readFileSync(f.calls, 'utf8')).toBe('native login\n');
});

it('keeps a stable owner binding when its setup object is reused', async () => {
  const f = await enrollmentFixture();

  f.configuration.scope.ownerId = 'unrelated-owner';
  const challenge = await f.enrollment.begin(f.request);

  expect(challenge.ownerId).toBe('owner-a');
});
