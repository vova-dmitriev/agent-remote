import { z } from 'zod';
import { ErrorCode } from '../errors/error-codes.js';
import { AgentProvider } from '../session/command-values.js';
import { CapabilitySupport, ProfileAuthMode, ProfileStatus, ReasoningEffort } from './values.js';
import {
  executionIdSchema as id,
  executionTimeSchema as time,
  executionVersionSchema as version,
} from './execution-fields.js';

export const executionCapabilitiesSchema = z.strictObject({
  isolation: z.enum(CapabilitySupport),
  createSession: z.boolean(),
  contextSeed: z.boolean(),
  resume: z.boolean(),
  quota: z.boolean(),
});

/** A model a sign-in offers, with the reasoning efforts it takes. */
export const agentModelSchema = z.strictObject({ id, efforts: z.array(z.enum(ReasoningEffort)).max(8) });
export type AgentModel = z.infer<typeof agentModelSchema>;

/** The models the device's own sign-in of an agent offers, for new sessions and for switching a session's model. */
export const providerModelsSchema = z.strictObject({
  provider: z.enum(AgentProvider),
  models: z.array(agentModelSchema).max(100),
});
export type ProviderModels = z.infer<typeof providerModelsSchema>;

/** A model, and optionally its reasoning effort, the owner picks for a session on the device's own sign-in. */
export const modelChoiceSchema = z.strictObject({ model: id, effort: z.enum(ReasoningEffort).optional() });
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const executionProfileSummarySchema = z
  .strictObject({
    id: z.uuid(),
    ownerId: id,
    deviceId: id,
    provider: z.enum(AgentProvider),
    authMode: z.enum(ProfileAuthMode),
    label: z.string().trim().min(1).max(128),
    status: z.enum(ProfileStatus),
    identity: z
      .strictObject({
        accountRef: id,
        accountLabel: z.string().trim().min(1).max(512).optional(),
        workspaceRef: id.optional(),
        verifiedAt: time,
      })
      .nullable(),
    capabilities: executionCapabilitiesSchema,
    models: z.array(agentModelSchema).max(100),
    version,
    updatedAt: time,
  })
  .refine(
    (profile) =>
      profile.status !== ProfileStatus.Ready ||
      (profile.identity !== null && profile.capabilities.isolation === CapabilitySupport.Supported),
    ErrorCode.PROFILE_NOT_READY,
  );

export const executionLaunchSelectionSchema = z.strictObject({
  profileId: z.uuid(),
  provider: z.enum(AgentProvider),
  model: id,
  effort: z.enum(ReasoningEffort).optional(),
});

// Internal plan validation uses an authoritative registry summary, never a caller-supplied profile.
export const executionLaunchPlanSchema = z
  .strictObject({
    profile: executionProfileSummarySchema,
    selection: executionLaunchSelectionSchema,
  })
  .superRefine(({ profile, selection }, context) => {
    let message: string | undefined;

    if (profile.id !== selection.profileId || profile.provider !== selection.provider) {
      message = ErrorCode.PROFILE_MISMATCH;
    } else if (profile.status !== ProfileStatus.Ready || !profile.capabilities.createSession) {
      message = ErrorCode.PROFILE_NOT_READY;
    } else {
      const model = profile.models.find((model) => model.id === selection.model);

      if (!model) {
        message = ErrorCode.PROFILE_MODEL_UNAVAILABLE;
      } else if (selection.effort !== undefined && !model.efforts.includes(selection.effort)) {
        message = ErrorCode.PROFILE_EFFORT_UNAVAILABLE;
      }
    }

    if (message !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

export type ExecutionCapabilities = z.infer<typeof executionCapabilitiesSchema>;
export type ExecutionProfileSummary = z.infer<typeof executionProfileSummarySchema>;
export type ExecutionLaunchSelection = z.infer<typeof executionLaunchSelectionSchema>;
export type ExecutionLaunchPlan = z.infer<typeof executionLaunchPlanSchema>;
