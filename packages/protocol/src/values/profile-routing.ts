export const FallbackMode = { Off: 'off', Ask: 'ask', Automatic: 'automatic' } as const;
export type FallbackMode = (typeof FallbackMode)[keyof typeof FallbackMode];

export const FallbackOverrideMode = { Inherit: 'inherit', Off: 'off', Policy: 'policy' } as const;
export type FallbackOverrideMode = (typeof FallbackOverrideMode)[keyof typeof FallbackOverrideMode];

export const FallbackTrigger = { QuotaExhausted: 'quota_exhausted' } as const;
export type FallbackTrigger = (typeof FallbackTrigger)[keyof typeof FallbackTrigger];

export const FallbackContextScope = {
  TaskSummary: 'task_summary',
  SelectedMessages: 'selected_messages',
  SelectedAttachments: 'selected_attachments',
  ProjectState: 'project_state',
} as const;
export type FallbackContextScope = (typeof FallbackContextScope)[keyof typeof FallbackContextScope];

export const QuotaObservationStatus = {
  Unknown: 'unknown',
  Available: 'available',
  Exhausted: 'exhausted',
} as const;
export type QuotaObservationStatus = (typeof QuotaObservationStatus)[keyof typeof QuotaObservationStatus];

export const QuotaScopeKind = {
  Account: 'account',
  Workspace: 'workspace',
  ModelFamily: 'model_family',
} as const;
export type QuotaScopeKind = (typeof QuotaScopeKind)[keyof typeof QuotaScopeKind];

export const QuotaEvidenceKind = {
  UsageAllowed: 'usage_allowed',
  UsageBlocked: 'usage_blocked',
  LimitReached: 'limit_reached',
} as const;
export type QuotaEvidenceKind = (typeof QuotaEvidenceKind)[keyof typeof QuotaEvidenceKind];

export const QuotaSource = { Unsupported: 'unsupported', CodexRateLimits: 'codex_rate_limits' } as const;
export type QuotaSource = (typeof QuotaSource)[keyof typeof QuotaSource];

export const CodexRateLimitReachedType = {
  RateLimitReached: 'rate_limit_reached',
  WorkspaceOwnerCreditsDepleted: 'workspace_owner_credits_depleted',
  WorkspaceMemberCreditsDepleted: 'workspace_member_credits_depleted',
  WorkspaceOwnerUsageLimitReached: 'workspace_owner_usage_limit_reached',
  WorkspaceMemberUsageLimitReached: 'workspace_member_usage_limit_reached',
} as const;
export type CodexRateLimitReachedType =
  (typeof CodexRateLimitReachedType)[keyof typeof CodexRateLimitReachedType];

export const ProfileRoutingLimits = {
  Policies: 32,
  Rules: 128,
  Overrides: 256,
  ContextScopes: 4,
  RuleHops: 3,
  NameBytes: 128,
  BudgetUsd: 1_000_000,
  ObservationAgeMs: 120_000,
} as const;

export const ProfileRoutingIssue = {
  Cycle: 'ROUTING_RULE_CYCLE',
  HopLimit: 'ROUTING_HOP_LIMIT',
  DuplicateRule: 'ROUTING_DUPLICATE_RULE',
  InvalidDefault: 'ROUTING_INVALID_DEFAULT',
  InvalidOverride: 'ROUTING_INVALID_OVERRIDE',
  ApiBudgetRequired: 'ROUTING_API_BUDGET_REQUIRED',
  InvalidObservation: 'ROUTING_INVALID_OBSERVATION',
} as const;
