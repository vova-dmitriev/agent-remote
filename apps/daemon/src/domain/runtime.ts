export const RuntimeEvent = {
  Frame: 'frame',
  Revoked: 'revoked',
  Snapshot: 'snapshot',
  Event: 'event',
  Online: 'online',
  Offline: 'offline',
  Notification: 'notification',
  Request: 'request',
  Disconnected: 'disconnected',
  Broadcast: 'broadcast',
  FrameTooLarge: 'frame_too_large',
  CommandResult: 'command_result',
} as const;

export type RuntimeEvent = (typeof RuntimeEvent)[keyof typeof RuntimeEvent];

export const ModelOrigin = {
  Native: 'native',
  Transcript: 'transcript',
} as const;

export type ModelOrigin = (typeof ModelOrigin)[keyof typeof ModelOrigin];

export const CommandStoreOutcome = {
  New: 'new',
} as const;

export type CommandStoreOutcome = (typeof CommandStoreOutcome)[keyof typeof CommandStoreOutcome];

export { ConnectorId } from '@protocol';

export const NativeProcessKind = {
  Interactive: 'interactive',
} as const;

export type NativeProcessKind = (typeof NativeProcessKind)[keyof typeof NativeProcessKind];

export const NativePidDomain = {
  Darwin: 'darwin',
} as const;

export type NativePidDomain = (typeof NativePidDomain)[keyof typeof NativePidDomain];

export const SourceVersion = {
  Unknown: 'unknown',
} as const;

export type SourceVersion = (typeof SourceVersion)[keyof typeof SourceVersion];
