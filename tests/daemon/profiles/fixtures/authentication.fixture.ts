import { CodedError } from '@protocol';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { ProfileAuthentication } from '@daemon/profiles/authentication/service.js';
import { codexSubscription, verifiedAccount } from './registry.fixture.js';
import { profileServiceFixture } from './service.fixture.js';

export function authenticationFixture() {
  const { options, service } = profileServiceFixture();
  const profile = service.registry.create(codexSubscription);
  let authorized = false;

  const loginSubscription = vi.fn(async () => ({
    loginId: 'synthetic-login',
    authUrl: 'https://auth.openai.com/authorize?state=synthetic',
  }));

  const close = vi.fn(async () => {});

  const probe = vi.fn(async () => {
    if (!authorized) {
      throw new CodedError('PROFILE_NOT_READY');
    }

    return verifiedAccount();
  });

  const open = vi.fn(async () => ({ loginSubscription, probe, close }));

  const configuration = {
    ...options,
    registry: service.registry,
    baseEnvironment: {},
    native: { executable: process.execPath },
    open,
  };

  const authentication = new ProfileAuthentication(configuration);

  const request = {
    action: 'sign_in_profile' as const,
    operationId: randomUUID(),
    profileId: profile.id,
    expectedVersion: 1,
  };

  return {
    options,
    service,
    profile,
    configuration,
    authentication,
    request,
    open,
    probe,
    loginSubscription,
    close,
    authorize: () => {
      authorized = true;
    },
  };
}
