import { CodedError } from '@protocol';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialEnrollmentService } from '../../../../apps/daemon/src/profiles/enrollment/service.js';
import { encryptEnrollment } from '@transport/credentials/sealed-box.js';
import { profileServiceFixture } from './service.fixture.js';
import { codexSubscription, verifiedAccount } from './registry.fixture.js';

export async function enrollmentFixture() {
  const { options, service, directory } = profileServiceFixture();
  const profile = service.registry.create({ ...codexSubscription, authMode: 'api_key' });
  const credential = join(directory, 'synthetic-native-key');
  const calls = join(directory, 'synthetic-native-logins');
  let now = 1000;
  let interrupted = false;
  let expectedKey: string | undefined;

  function evidence() {
    if (!expectedKey) {
      throw new CodedError('PROFILE_NOT_READY');
    }

    return {
      ...verifiedAccount(),
      authMode: 'api_key' as const,
      identity: {
        accountRef: 'codex-key:' + createHash('sha256').update(expectedKey).digest('hex'),
        verifiedAt: now,
      },
    };
  }

  const configuration = {
    ...options,
    registry: service.registry,
    now: () => now,
    apply: async (key: string) => {
      if (existsSync(credential)) {
        throw new CodedError('DUPLICATE_NATIVE_AUTH');
      }

      writeFileSync(credential, key, { mode: 0o600 });
      appendFileSync(calls, 'native login\n', { mode: 0o600 });
      expectedKey = key;

      if (interrupted) {
        throw new CodedError('UNKNOWN_AFTER_WRITE');
      }

      return evidence();
    },
    check: async () => evidence(),
    hasNativeCloseProof: () => true,
  };

  const enrollment = new CredentialEnrollmentService(configuration);
  const recipient = await enrollment.recipient();

  const request = {
    operationId: randomUUID(),
    profileId: profile.id,
    expectedVersion: 1,
    pinnedKeyId: recipient.recipientKeyId,
  };

  return {
    enrollment,
    configuration,
    service,
    options,
    profile,
    request,
    credential,
    calls,
    setTime: (value: number) => {
      now = value;
    },
    interrupt: () => {
      interrupted = true;
    },
    seal: async (key = 'synthetic-private-enrollment-key') =>
      encryptEnrollment(await enrollment.begin(request), key, recipient.recipientKeyId, now),
  };
}
