import { z } from 'zod';
import { AgentProvider } from '../session/command-values.js';
import { ProfileAuthMode } from '../execution/values.js';
import {
  CodexRateLimitReachedType,
  QuotaEvidenceKind,
  QuotaObservationStatus,
  QuotaSource,
  QuotaScopeKind,
} from './routing-values.js';
import { ProfileRoutingIssue } from './routing-values.js';
import {
  executionIdSchema as id,
  executionTimeSchema as time,
  executionVersionSchema as version,
} from '../execution/execution-fields.js';

const quotaEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(QuotaEvidenceKind.UsageAllowed), allowed: z.literal(true) }),
  z.strictObject({ kind: z.literal(QuotaEvidenceKind.UsageBlocked), allowed: z.literal(false) }),
  z.strictObject({
    kind: z.literal(QuotaEvidenceKind.LimitReached),
    reason: z.enum(CodexRateLimitReachedType),
  }),
]);

export const profileQuotaObservationSchema = z
  .strictObject({
    ownerId: id,
    deviceId: id,
    profileId: z.uuid(),
    profileVersion: version,
    provider: z.enum(AgentProvider),
    authMode: z.enum(ProfileAuthMode),
    accountRef: id,
    workspaceRef: id.optional(),
    source: z.enum(QuotaSource),
    supported: z.boolean(),
    scope: z.strictObject({ kind: z.enum(QuotaScopeKind), id: id.optional() }),
    poolId: id.optional(),
    modelId: id.optional(),
    status: z.enum(QuotaObservationStatus),
    evidence: quotaEvidenceSchema.nullable(),
    usedPercent: z.number().int().min(0).max(100).optional(),
    resetsAt: time.optional(),
    observedAt: time,
  })
  .superRefine((observation, context) => {
    const exhausted = observation.status === QuotaObservationStatus.Exhausted;
    const available = observation.status === QuotaObservationStatus.Available;

    const blocked = observation.evidence?.kind === QuotaEvidenceKind.UsageBlocked;
    const reached = observation.evidence?.kind === QuotaEvidenceKind.LimitReached;

    if (exhausted !== (reached || blocked)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: ProfileRoutingIssue.InvalidObservation,
      });
    }

    if (available !== (observation.evidence?.kind === QuotaEvidenceKind.UsageAllowed)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: ProfileRoutingIssue.InvalidObservation,
      });
    }
  });

export type ProfileQuotaObservation = z.infer<typeof profileQuotaObservationSchema>;
