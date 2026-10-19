export const ProfileAuthMode = {
  Subscription: 'subscription',
  ApiKey: 'api_key',
} as const;
export type ProfileAuthMode = (typeof ProfileAuthMode)[keyof typeof ProfileAuthMode];

export const ProfileStatus = {
  Ready: 'ready',
  NeedsAuthentication: 'needs_authentication',
  Disabled: 'disabled',
  Removing: 'removing',
  Removed: 'removed',
} as const;
export type ProfileStatus = (typeof ProfileStatus)[keyof typeof ProfileStatus];

export const CapabilitySupport = {
  Supported: 'supported',
  Unsupported: 'unsupported',
  Unknown: 'unknown',
} as const;
export type CapabilitySupport = (typeof CapabilitySupport)[keyof typeof CapabilitySupport];

export const ExecutionMode = {
  ManagedCli: 'managed_cli',
  Desktop: 'desktop',
} as const;
export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];

export const ReasoningEffort = {
  None: 'none',
  Minimal: 'minimal',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Xhigh: 'xhigh',
  Max: 'max',
  Ultra: 'ultra',
} as const;
export type ReasoningEffort = (typeof ReasoningEffort)[keyof typeof ReasoningEffort];

export const HandoffPhase = {
  Preparing: 'preparing',
  AwaitingSource: 'awaiting_source',
  AwaitingAuth: 'awaiting_auth',
  CreatingTarget: 'creating_target',
  DeliveringContext: 'delivering_context',
  Ready: 'ready',
  Failed: 'failed',
  Unknown: 'unknown',
} as const;
export type HandoffPhase = (typeof HandoffPhase)[keyof typeof HandoffPhase];

export const CheckpointCoverage = {
  Complete: 'complete',
  RecentWindow: 'recent_window',
} as const;
export type CheckpointCoverage = (typeof CheckpointCoverage)[keyof typeof CheckpointCoverage];

export const CheckpointApprovalKind = {
  Manual: 'manual',
  Policy: 'policy',
} as const;
export type CheckpointApprovalKind = (typeof CheckpointApprovalKind)[keyof typeof CheckpointApprovalKind];
