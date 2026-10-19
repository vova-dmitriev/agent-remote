import { z } from 'zod';
import { AgentProvider } from './values/command.js';
import { ReasoningEffort } from './values/execution.js';
import {
  FallbackContextScope,
  FallbackMode,
  FallbackOverrideMode,
  FallbackTrigger,
  ProfileRoutingIssue,
  ProfileRoutingLimits,
} from './values/profile-routing.js';
import { executionIdSchema as id, executionVersionSchema as version } from './execution-fields.js';
import { profileQuotaObservationSchema, type ProfileQuotaObservation } from './profile-quota.js';

const routingVersion = z.number().int().nonnegative().safe();

export const fallbackRuleSchema = z.strictObject({
  id: z.uuid(),
  sourceProfileId: z.uuid(),
  sourceProfileVersion: version,
  destinationProfileId: z.uuid(),
  destinationProfileVersion: version,
  sourceModelId: id.optional(),
  destinationProvider: z.enum(AgentProvider),
  destinationModel: id,
  destinationEffort: z.enum(ReasoningEffort).optional(),
  trigger: z.enum(FallbackTrigger),
});

const apiSpendingSchema = z
  .strictObject({
    enabled: z.boolean(),
    limitUsd: z.number().positive().max(ProfileRoutingLimits.BudgetUsd).nullable(),
  })
  .refine((value) => value.enabled === (value.limitUsd !== null), ProfileRoutingIssue.ApiBudgetRequired);

function inspectRuleGraph(rules: z.infer<typeof fallbackRuleSchema>[]) {
  const graph = new Map<string, string[]>();

  for (const rule of rules) {
    const destinations = graph.get(rule.sourceProfileId) ?? [];

    destinations.push(rule.destinationProfileId);
    graph.set(rule.sourceProfileId, destinations);
  }

  const visiting = new Set<string>();
  const memo = new Map<string, number>();

  function depth(profileId: string): number {
    if (visiting.has(profileId)) {
      return Number.POSITIVE_INFINITY;
    }

    if (memo.has(profileId)) {
      return memo.get(profileId)!;
    }

    visiting.add(profileId);
    const result = Math.max(0, ...(graph.get(profileId) ?? []).map((target) => 1 + depth(target)));

    visiting.delete(profileId);
    memo.set(profileId, result);

    return result;
  }

  const maximum = Math.max(0, ...[...graph.keys()].map((profileId) => depth(profileId)));

  return { cyclic: !Number.isFinite(maximum), maximum };
}

export const fallbackPolicySchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(ProfileRoutingLimits.NameBytes),
    mode: z.enum(FallbackMode),
    rules: z.array(fallbackRuleSchema).max(ProfileRoutingLimits.Rules),
    contextScope: z.array(z.enum(FallbackContextScope)).min(1).max(ProfileRoutingLimits.ContextScopes),
    moveUnsentQueue: z.boolean(),
    apiSpending: apiSpendingSchema,
  })
  .superRefine((policy, context) => {
    const ruleIds = new Set<string>();

    for (const [index, rule] of policy.rules.entries()) {
      if (rule.sourceProfileId === rule.destinationProfileId || ruleIds.has(rule.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', index],
          message: ProfileRoutingIssue.DuplicateRule,
        });
      }

      ruleIds.add(rule.id);
    }

    const graph = inspectRuleGraph(policy.rules);

    if (graph.cyclic) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rules'], message: ProfileRoutingIssue.Cycle });
    } else if (graph.maximum > ProfileRoutingLimits.RuleHops) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules'],
        message: ProfileRoutingIssue.HopLimit,
      });
    }
  });

const overrideSchema = z
  .strictObject({
    conversationId: id,
    mode: z.enum(FallbackOverrideMode),
    policyId: z.uuid().optional(),
  })
  .refine(
    (override) => (override.mode === FallbackOverrideMode.Policy) === (override.policyId !== undefined),
    ProfileRoutingIssue.InvalidOverride,
  );

export const profileRoutingSettingsSchema = z
  .strictObject({
    ownerId: id,
    deviceId: id,
    version: routingVersion,
    defaultPolicyId: z.uuid().nullable(),
    policies: z.array(fallbackPolicySchema).max(ProfileRoutingLimits.Policies),
    overrides: z.array(overrideSchema).max(ProfileRoutingLimits.Overrides),
  })
  .superRefine((settings, context) => {
    const policyIds = new Set(settings.policies.map((policy) => policy.id));

    if (
      new Set(policyIds).size !== settings.policies.length ||
      (settings.defaultPolicyId !== null && !policyIds.has(settings.defaultPolicyId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultPolicyId'],
        message: ProfileRoutingIssue.InvalidDefault,
      });
    }

    const conversations = new Set<string>();

    settings.overrides.forEach((override, index) => {
      if (
        conversations.has(override.conversationId) ||
        (override.policyId && !policyIds.has(override.policyId))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrides', index],
          message: ProfileRoutingIssue.InvalidOverride,
        });
      }

      conversations.add(override.conversationId);
    });
  });

export const saveProfileRoutingSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().safe(),
  defaultPolicyId: z.uuid().nullable(),
  policies: z.array(fallbackPolicySchema).max(ProfileRoutingLimits.Policies),
  overrides: z.array(overrideSchema).max(ProfileRoutingLimits.Overrides),
});

export const profileRoutingSnapshotSchema = z.strictObject({
  settings: profileRoutingSettingsSchema,
  observations: z.array(profileQuotaObservationSchema).max(100),
});

export type FallbackRule = z.infer<typeof fallbackRuleSchema>;
export type FallbackPolicy = z.infer<typeof fallbackPolicySchema>;
export type ProfileRoutingSettings = z.infer<typeof profileRoutingSettingsSchema>;
export type SaveProfileRouting = z.infer<typeof saveProfileRoutingSchema>;

export interface ProfileRoutingAccess {
  get(): Promise<{ settings: ProfileRoutingSettings; observations: ProfileQuotaObservation[] }>;
  save(input: SaveProfileRouting): Promise<ProfileRoutingSettings>;
}
