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
