import { z } from 'zod';
import { executionProfileSummarySchema, profileCreateInputSchema, profileUpdateInputSchema } from '@protocol';

export {
  profileCreateInputSchema as createProfileSchema,
  profileUpdateInputSchema as updateProfileSchema,
} from '@protocol';

const fields = executionProfileSummarySchema.shape;

export const profileVerificationSchema = z.strictObject({
  provider: fields.provider,
  authMode: fields.authMode,
  identity: fields.identity,
  capabilities: fields.capabilities,
  models: fields.models,
});

export type { ProfileScope } from '../domain/ports/runtime-profiles.js';
export type CreateProfile = z.infer<typeof profileCreateInputSchema>;
export type UpdateProfile = z.infer<typeof profileUpdateInputSchema>;
export type ProfileVerification = z.infer<typeof profileVerificationSchema>;
