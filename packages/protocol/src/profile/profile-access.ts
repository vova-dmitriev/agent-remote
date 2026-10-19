import { z } from 'zod';
import { profileAuthUrlSchema } from '../credentials/profile-auth-url.js';
import { ErrorCode } from '../errors/error-codes.js';
import { profileQuotaObservationSchema } from './profile-quota.js';
import { ProfileAction, ProfileRequestKind, ProfileLimits } from './management-values.js';
import { profileMutationSchema, profileOperationSchema, profileListSchema } from './profile-management.js';
import {
  beginEnrollmentSchema,
  encryptedEnrollmentSchema,
  enrollmentChallengeSchema,
} from '../credentials/credential-enrollment.js';

export const profileAuthenticationSchema = z.strictObject({
  operationId: z.uuid(),
  profileId: z.uuid(),
  expectedVersion: z.number().int().positive().safe(),
  action: z.enum([ProfileAction.SignIn, ProfileAction.Check]),
});

export const profileRecipientSchema = enrollmentChallengeSchema.pick({
  version: true,
  algorithm: true,
  ownerId: true,
  deviceId: true,
  recipientKeyId: true,
  recipientPublicKey: true,
});

export const profileLoginSchema = z.strictObject({
  loginId: z.string().min(1).max(512),
  authUrl: profileAuthUrlSchema,
});

const kind = <T extends ProfileRequestKind>(value: T) => ({ kind: z.literal(value) });
const operationId = { operationId: z.uuid() };

export const profileRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject(kind(ProfileRequestKind.List)),
  z.strictObject({
    ...kind(ProfileRequestKind.ListPage),
    offset: z
      .number()
      .int()
      .min(0)
      .max(ProfileLimits.ActiveProfiles * 2),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({ ...kind(ProfileRequestKind.Mutate), mutation: profileMutationSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.Operation), ...operationId }),
  z.strictObject({ ...kind(ProfileRequestKind.Reconcile), ...operationId }),
  z.strictObject(kind(ProfileRequestKind.Recipient)),
  z.strictObject({ ...kind(ProfileRequestKind.BeginEnrollment), input: beginEnrollmentSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.CompleteEnrollment), input: encryptedEnrollmentSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.Authenticate), input: profileAuthenticationSchema }),
  z.strictObject({
    ...kind(ProfileRequestKind.Quota),
    profileId: z.uuid(),
    expectedVersion: z.number().int().positive().safe(),
  }),
]);

export const profileResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...kind(ProfileRequestKind.List), data: profileListSchema }),
  z.strictObject({
    ...kind(ProfileRequestKind.ListPage),
    data: profileListSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    nextOffset: z
      .number()
      .int()
      .positive()
      .max(ProfileLimits.ActiveProfiles * 2)
      .nullable(),
  }),
  z.strictObject({ ...kind(ProfileRequestKind.Mutate), data: profileOperationSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.Operation), data: profileOperationSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.Reconcile), data: profileOperationSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.Recipient), data: profileRecipientSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.BeginEnrollment), data: enrollmentChallengeSchema }),
  z.strictObject({ ...kind(ProfileRequestKind.CompleteEnrollment), data: profileOperationSchema }),
  z.strictObject({
    ...kind(ProfileRequestKind.Authenticate),
    data: profileOperationSchema,
    login: profileLoginSchema.optional(),
  }),
  z.strictObject({ ...kind(ProfileRequestKind.Quota), data: profileQuotaObservationSchema.nullable() }),
]);

export const profileReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), response: profileResponseSchema }),
  z.strictObject({ ok: z.literal(false), code: z.enum(ErrorCode) }),
]);

export type ProfileAuthenticationRequest = z.infer<typeof profileAuthenticationSchema>;
export type ProfileRecipient = z.infer<typeof profileRecipientSchema>;
export type ProfileLogin = z.infer<typeof profileLoginSchema>;
export type ProfileRequest = z.infer<typeof profileRequestSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type ProfileReply = z.infer<typeof profileReplySchema>;

export interface ExecutionProfileAccess {
  request(input: ProfileRequest): Promise<ProfileResponse>;
}
