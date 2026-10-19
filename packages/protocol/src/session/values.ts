export const DeviceStatus = {
  Online: 'online',
  Offline: 'offline',
} as const;

export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const ConnectionStatus = {
  Connecting: 'connecting',
  Online: 'online',
  Offline: 'offline',
  Expired: 'expired',
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export const SessionStatus = {
  Unknown: 'unknown',
  Idle: 'idle',
  Running: 'running',
  WaitingPermission: 'waiting_permission',
  WaitingInput: 'waiting_input',
  Ended: 'ended',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const IntegrationState = {
  Ready: 'ready',
  NeedsSetup: 'needs_setup',
  NeedsRestart: 'needs_restart',
  Unsupported: 'unsupported',
  Disconnected: 'disconnected',
} as const;

export type IntegrationState = (typeof IntegrationState)[keyof typeof IntegrationState];

export const IntegrationReason = {
  CliWrapperRequired: 'CLI_WRAPPER_REQUIRED',
} as const;

export type IntegrationReason = (typeof IntegrationReason)[keyof typeof IntegrationReason];

export const BindingState = {
  Verified: 'verified',
  Unverified: 'unverified',
} as const;

export type BindingState = (typeof BindingState)[keyof typeof BindingState];

export const StatusConfidence = {
  Observed: 'observed',
  Inferred: 'inferred',
} as const;

export type StatusConfidence = (typeof StatusConfidence)[keyof typeof StatusConfidence];

export const NativeRestartState = {
  Available: 'available',
  Missing: 'missing',
  Ambiguous: 'ambiguous',
} as const;

export type NativeRestartState = (typeof NativeRestartState)[keyof typeof NativeRestartState];

export const ActivityKind = {
  Command: 'command',
  Read: 'read',
  Write: 'write',
  Search: 'search',
  Web: 'web',
  Tool: 'tool',
} as const;

export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

/** Lifecycle of one tool call surfaced as a history item (subagent transcripts). */
export const ToolActivityPhase = {
  Started: 'started',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type ToolActivityPhase = (typeof ToolActivityPhase)[keyof typeof ToolActivityPhase];

export const SubagentStatus = {
  Queued: 'queued',
  Running: 'running',
  WaitingInput: 'waiting_input',
  Completed: 'completed',
  Failed: 'failed',
  Stopped: 'stopped',
  Unknown: 'unknown',
} as const;

export type SubagentStatus = (typeof SubagentStatus)[keyof typeof SubagentStatus];
