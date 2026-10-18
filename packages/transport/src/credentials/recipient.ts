import sodium from 'libsodium-wrappers';
import {
  CredentialEnrollmentLimits,
  CredentialEnrollmentDigest,
  ErrorCode,
} from '../../../protocol/src/index.js';
import type { EnrollmentRecipient } from './types.js';

export function decodeEnrollmentBase64(value: string) {
  try {
    const bytes = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);

    if (sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL) !== value) {
      throw new Error();
    }

    return bytes;
  } catch {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }
}

export async function enrollmentKeyId(publicKey: string) {
  await sodium.ready;
  const bytes = decodeEnrollmentBase64(publicKey);

  if (bytes.byteLength !== CredentialEnrollmentLimits.PublicKeyBytes) {
    throw new Error(ErrorCode.ENROLLMENT_INVALID);
  }

  const digest = await crypto.subtle.digest(CredentialEnrollmentDigest.Sha256, new Uint8Array(bytes).buffer);

  return sodium.to_hex(new Uint8Array(digest));
}

export async function createEnrollmentRecipient(): Promise<EnrollmentRecipient> {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  const publicKey = sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL);

  return { publicKey, privateKey: pair.privateKey, keyId: await enrollmentKeyId(publicKey) };
}

export async function restoreEnrollmentRecipient(
  publicKey: string,
  privateKey: string,
): Promise<EnrollmentRecipient> {
  await sodium.ready;
  const secret = decodeEnrollmentBase64(privateKey);
  const expected = decodeEnrollmentBase64(publicKey);

  if (
    secret.byteLength !== sodium.crypto_box_SECRETKEYBYTES ||
    expected.byteLength !== sodium.crypto_box_PUBLICKEYBYTES ||
    sodium.to_hex(sodium.crypto_scalarmult_base(secret)) !== sodium.to_hex(expected)
  ) {
    sodium.memzero(secret);
    throw new Error(ErrorCode.ENROLLMENT_KEY_UNTRUSTED);
  }

  return { publicKey, privateKey: secret, keyId: await enrollmentKeyId(publicKey) };
}
