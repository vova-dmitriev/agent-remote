export const CommandStatus = {
  Accepted: 'accepted',
  Dispatched: 'dispatched',
  Rejected: 'rejected',
  Unknown: 'unknown',
} as const;

export type CommandStatus = (typeof CommandStatus)[keyof typeof CommandStatus];

export const CommandActionType = {
  Prompt: 'prompt',
  CreateSession: 'create_session',
  RestartSession: 'restart_session',
  Escape: 'escape',
  Interrupt: 'interrupt',
  Permission: 'permission',
  UserInput: 'user_input',
} as const;

export type CommandActionType = (typeof CommandActionType)[keyof typeof CommandActionType];

export const PermissionDecision = {
  Allow: 'allow',
  Deny: 'deny',
  Local: 'local',
} as const;

export type PermissionDecision = (typeof PermissionDecision)[keyof typeof PermissionDecision];

export const AgentProvider = {
  Claude: 'claude',
  Codex: 'codex',
} as const;

export type AgentProvider = (typeof AgentProvider)[keyof typeof AgentProvider];

export const CapabilityKey = {
  Prompt: 'prompt',
  Interrupt: 'interrupt',
  Permission: 'permission',
  UserInput: 'userInput',
  CreateSession: 'createSession',
  RestartSession: 'restartSession',
} as const;

export type CapabilityKey = (typeof CapabilityKey)[keyof typeof CapabilityKey];

export const RemotePermissionDecision = {
  Allow: PermissionDecision.Allow,
  Deny: PermissionDecision.Deny,
} as const;
export type RemotePermissionDecision =
  (typeof RemotePermissionDecision)[keyof typeof RemotePermissionDecision];

export const PromptDelivery = {
  WhenIdle: 'when_idle',
  Immediate: 'immediate',
} as const;

export type PromptDelivery = (typeof PromptDelivery)[keyof typeof PromptDelivery];
