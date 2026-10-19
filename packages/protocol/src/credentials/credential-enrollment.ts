import { z } from 'zod';
import { CredentialEnrollmentAlgorithm, CredentialEnrollmentLimits } from './values.js';
import {
  executionIdSchema,
  executionVersionSchema,
  executionTimeSchema,
} from '../execution/execution-fields.js';

export const enrollmentChallengeSchema = z.strictObject({
  version: z.literal(CredentialEnrollmentLimits.Version),
  algorithm: z.literal(CredentialEnrollmentAlgorithm.SealedBox),
  ownerId: executionIdSchema,
  deviceId: executionIdSchema,
  profileId: z.uuid(),
  operationId: z.uuid(),
  profileVersion: executionVersionSchema,
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
  recipientKeyId: z.string().regex(/^[a-f0-9]{64}$/),
  recipientPublicKey: z
    .string()
    .length(CredentialEnrollmentLimits.PublicKeyCharacters)
    .regex(/^[A-Za-z0-9+/]+=$/),
  issuedAt: executionTimeSchema,
  expiresAt: executionTimeSchema,
});

export const encryptedEnrollmentSchema = z.strictObject({
  operationId: z.uuid(),
  ciphertext: z
    .string()
    .min(1)
    .max(CredentialEnrollmentLimits.CiphertextCharacters)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const enrollmentCredentialBodySchema = z.strictObject({
  ...enrollmentChallengeSchema.shape,
  apiKey: z.string().min(1).max(CredentialEnrollmentLimits.SecretBytes),
});

export type EnrollmentChallenge = z.infer<typeof enrollmentChallengeSchema>;
export type EncryptedEnrollment = z.infer<typeof encryptedEnrollmentSchema>;
export type EnrollmentCredentialBody = z.infer<typeof enrollmentCredentialBodySchema>;

export const beginEnrollmentSchema = z.strictObject({
  operationId: z.uuid(),
  profileId: z.uuid(),
  expectedVersion: executionVersionSchema,
  pinnedKeyId: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BeginEnrollmentRequest = z.infer<typeof beginEnrollmentSchema>;
