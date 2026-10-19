import { z } from 'zod';
import { ErrorCode } from '../errors/error-codes.js';
import { AgentProvider } from '../session/command-values.js';
import { ProfileAuthMode } from '../execution/values.js';
import { ProfileAction, ProfileOperationPhase, ProfileLimits } from './management-values.js';
import { executionProfileSummarySchema } from '../execution/execution-profile.js';
import {
  executionIdSchema,
  executionVersionSchema,
  executionTimeSchema,
} from '../execution/execution-fields.js';

export const profileCreateInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(128),
  provider: z.enum(AgentProvider),
  authMode: z.enum(ProfileAuthMode),
});
export const profileUpdateInputSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(128).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const operation = { operationId: z.uuid() };
const existing = { ...operation, profileId: z.uuid(), expectedVersion: executionVersionSchema };

export const profileMutationSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...operation, action: z.literal(ProfileAction.Create), input: profileCreateInputSchema }),
  z.strictObject({
    ...existing,
    action: z.literal(ProfileAction.Rename),
    label: z.string().trim().min(1).max(128),
  }),
  z.strictObject({ ...existing, action: z.literal(ProfileAction.Disable) }),
  z.strictObject({ ...existing, action: z.literal(ProfileAction.Enable) }),
  z.strictObject({ ...existing, action: z.literal(ProfileAction.SetDefault) }),
  z.strictObject({ ...existing, action: z.literal(ProfileAction.Remove) }),
]);

export const profileOperationSchema = z.strictObject({
  id: z.uuid(),
  ownerId: executionIdSchema,
  deviceId: executionIdSchema,
  profileId: z.uuid(),
  action: z.enum(ProfileAction),
  phase: z.enum(ProfileOperationPhase),
  profileVersion: executionVersionSchema,
  version: executionVersionSchema,
  code: z.enum(ErrorCode).optional(),
  createdAt: executionTimeSchema,
  updatedAt: executionTimeSchema,
});

export const profileListSchema = z.strictObject({
  available: z.boolean(),
  observedAt: executionTimeSchema,
  profiles: z.array(executionProfileSummarySchema).max(ProfileLimits.ActiveProfiles),
  operations: z.array(profileOperationSchema).max(ProfileLimits.ActiveProfiles),
  defaults: z.strictObject({
    [AgentProvider.Claude]: z.uuid().nullable(),
    [AgentProvider.Codex]: z.uuid().nullable(),
  }),
});

export type ProfileMutation = z.infer<typeof profileMutationSchema>;
export type ProfileOperation = z.infer<typeof profileOperationSchema>;
export type ProfileList = z.infer<typeof profileListSchema>;
