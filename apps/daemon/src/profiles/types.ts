import { z } from 'zod';
import { executionProfileSummarySchema } from '../../../../packages/protocol/src/index.js';

export {
  profileCreateInputSchema as createProfileSchema,
  profileUpdateInputSchema as updateProfileSchema,
} from '../../../../packages/protocol/src/index.js';
import {
  profileCreateInputSchema,
  profileUpdateInputSchema,
} from '../../../../packages/protocol/src/index.js';

const fields = executionProfileSummarySchema.shape;

export const profileVerificationSchema = z.strictObject({
  provider: fields.provider,
  authMode: fields.authMode,
  identity: fields.identity,
  capabilities: fields.capabilities,
  models: fields.models,
});

export interface ProfileScope {
  readonly ownerId: string;
  readonly deviceId: string;
}
export type CreateProfile = z.infer<typeof profileCreateInputSchema>;
export type UpdateProfile = z.infer<typeof profileUpdateInputSchema>;
export type ProfileVerification = z.infer<typeof profileVerificationSchema>;
