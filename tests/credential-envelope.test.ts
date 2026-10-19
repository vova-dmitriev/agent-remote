import { expect, it } from 'vitest';
import {
  createEnrollmentRecipient,
  encryptEnrollment,
  decryptEnrollment,
} from '@transport/credentials/sealed-box.js';

async function fixture() {
  const recipient = await createEnrollmentRecipient();

  const challenge = {
    version: 1 as const,
    algorithm: 'sodium_sealed_box' as const,
    ownerId: 'owner-a',
    deviceId: 'mac-a',
    profileId: '00000000-0000-4000-8000-000000000001',
    operationId: '00000000-0000-4000-8000-000000000002',
    profileVersion: 1,
    challenge: 'a'.repeat(64),
    recipientKeyId: recipient.keyId,
    recipientPublicKey: recipient.publicKey,
    issuedAt: 1000,
    expiresAt: 301000,
  };

  return { recipient, challenge };
}

it('round-trips a bound credential through audited sealed boxes without plaintext in the envelope', async () => {
  const { recipient, challenge } = await fixture();

  const envelope = await encryptEnrollment(
    challenge,
    'synthetic-disposable-credential',
    recipient.keyId,
    1000,
  );

  const body = await decryptEnrollment(envelope, challenge, recipient, 1001);

  expect(body.apiKey).toBe('synthetic-disposable-credential');
  expect(body.ownerId).toBe('owner-a');
  expect(body.profileId).toBe('00000000-0000-4000-8000-000000000001');
  expect(Object.keys(envelope).sort()).toEqual(['ciphertext', 'operationId']);
  expect(JSON.stringify(envelope)).not.toContain('synthetic-disposable-credential');
  expect(JSON.stringify(envelope)).not.toContain('apiKey');
});

it('rejects an unpinned or substituted device key before encrypting a credential', async () => {
  const { recipient, challenge } = await fixture();
  const attacker = await createEnrollmentRecipient();

  await expect(encryptEnrollment(challenge, 'synthetic-private', '0'.repeat(64), 1000)).rejects.toThrow(
    'ENROLLMENT_KEY_UNTRUSTED',
  );

  await expect(
    encryptEnrollment(
      { ...challenge, recipientPublicKey: attacker.publicKey },
      'synthetic-private',
      recipient.keyId,
      1000,
    ),
  ).rejects.toThrow('ENROLLMENT_KEY_UNTRUSTED');
});

it.each(['ownerId', 'deviceId', 'profileId', 'profileVersion', 'challenge'])(
  'rejects retagged %s after decryption',
  async (field) => {
    const { recipient, challenge } = await fixture();
    const altered = { ...challenge, [field]: field === 'profileVersion' ? 2 : 'different' };

    if (field === 'profileId') {
      altered[field] = '00000000-0000-4000-8000-000000000009';
    }

    if (field === 'challenge') {
      altered[field] = 'b'.repeat(64);
    }

    const envelope = await encryptEnrollment(altered, 'synthetic-private', recipient.keyId, 1000);

    await expect(decryptEnrollment(envelope, challenge, recipient, 1001)).rejects.toThrow(
      'ENROLLMENT_INVALID',
    );
  },
);

it('rejects expired and malformed ciphertext with safe errors', async () => {
  const { recipient, challenge } = await fixture();

  await expect(encryptEnrollment(challenge, 'synthetic-private', recipient.keyId, 301000)).rejects.toThrow(
    'ENROLLMENT_EXPIRED',
  );

  await expect(
    encryptEnrollment({ ...challenge, expiresAt: 9999999 }, 'synthetic-private', recipient.keyId, 1000),
  ).rejects.toThrow('ENROLLMENT_INVALID');

  const envelope = await encryptEnrollment(challenge, 'synthetic-private', recipient.keyId, 1000);
  const corrupted = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) };

  await expect(decryptEnrollment(corrupted, challenge, recipient, 1001)).rejects.toThrow(
    'ENROLLMENT_INVALID',
  );

  await expect(decryptEnrollment(envelope, challenge, recipient, 301000)).rejects.toThrow(
    'ENROLLMENT_EXPIRED',
  );

  await expect(
    decryptEnrollment({ ...envelope, apiKey: 'synthetic-private' } as never, challenge, recipient, 1001),
  ).rejects.toThrow('ENROLLMENT_INVALID');
});
