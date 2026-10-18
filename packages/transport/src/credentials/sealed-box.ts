import sodium from 'libsodium-wrappers';
import {
  CredentialEnrollmentLimits,
  ErrorCode,
  enrollmentChallengeSchema,
  encryptedEnrollmentSchema,
  enrollmentCredentialBodySchema,
  type EnrollmentChallenge,
  type EncryptedEnrollment,
} from '../../../protocol/src/index.js';
import { decodeEnrollmentBase64, enrollmentKeyId } from './recipient.js';
import type { EnrollmentRecipient } from './types.js';

export { createEnrollmentRecipient } from './recipient.js';

function boundChallenge(input: EnrollmentChallenge, now: number) {
  const parsed = enrollmentChallengeSchema.safeParse(input);

  if (
    !parsed.success ||
    !Number.isSafeInteger(now) ||
    parsed.data.expiresAt !== parsed.data.issuedAt + CredentialEnrollmentLimits.LifetimeMs ||
    parsed.data.issuedAt > now + CredentialEnrollmentLimits.ClockSkewMs
  ) {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }

  if (parsed.data.expiresAt <= now) {
    throw new Error(ErrorCode.ENROLLMENT_EXPIRED);
  }

  return parsed.data;
}

export async function encryptEnrollment(
  input: EnrollmentChallenge,
  apiKey: string,
  pinnedKeyId: string,
  now = Date.now(),
): Promise<EncryptedEnrollment> {
  await sodium.ready;
  const challenge = boundChallenge(input, now);

  if (
    challenge.recipientKeyId !== pinnedKeyId ||
    (await enrollmentKeyId(challenge.recipientPublicKey)) !== pinnedKeyId
  ) {
    throw new Error(ErrorCode.ENROLLMENT_KEY_UNTRUSTED);
  }

  const body = enrollmentCredentialBodySchema.safeParse({ ...challenge, apiKey });

  if (!body.success || sodium.from_string(apiKey).byteLength > CredentialEnrollmentLimits.SecretBytes) {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }

  const bytes = sodium.from_string(JSON.stringify(body.data));

  try {
    if (bytes.byteLength > CredentialEnrollmentLimits.PlaintextBytes) {
      throw new Error(ErrorCode.ENROLLMENT_INVALID);
    }

    const ciphertext = sodium.crypto_box_seal(bytes, decodeEnrollmentBase64(challenge.recipientPublicKey));

    return {
      operationId: challenge.operationId,
      ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    };
  } finally {
    sodium.memzero(bytes);
  }
}

export async function decryptEnrollment(
  input: EncryptedEnrollment,
  expected: EnrollmentChallenge,
  recipient: EnrollmentRecipient,
  now = Date.now(),
) {
  await sodium.ready;
  const challenge = boundChallenge(expected, now);
  const envelope = encryptedEnrollmentSchema.safeParse(input);

  if (!envelope.success || envelope.data.operationId !== challenge.operationId) {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }

  if (
    challenge.recipientKeyId !== recipient.keyId ||
    challenge.recipientPublicKey !== recipient.publicKey ||
    (await enrollmentKeyId(recipient.publicKey)) !== recipient.keyId
  ) {
    throw new Error(ErrorCode.ENROLLMENT_KEY_UNTRUSTED);
  }

  let bytes: Uint8Array;

  try {
    bytes = sodium.crypto_box_seal_open(
      decodeEnrollmentBase64(envelope.data.ciphertext),
      decodeEnrollmentBase64(recipient.publicKey),
      recipient.privateKey,
    );
  } catch {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }

  try {
    if (bytes.byteLength > CredentialEnrollmentLimits.PlaintextBytes) {
      throw new Error(ErrorCode.ENROLLMENT_INVALID);
    }

    let raw: unknown;

    try {
      raw = JSON.parse(sodium.to_string(bytes));
    } catch {
      throw new Error(ErrorCode.ENROLLMENT_INVALID);
    }

    const body = enrollmentCredentialBodySchema.safeParse(raw);

    if (!body.success) {
      throw new Error(ErrorCode.ENROLLMENT_INVALID);
    }

    const { apiKey: _secret, ...binding } = body.data;

    if (JSON.stringify(binding) !== JSON.stringify(challenge)) {
      throw new Error(ErrorCode.ENROLLMENT_INVALID);
    }

    return body.data;
  } finally {
    sodium.memzero(bytes);
  }
}
