import type { Conversation, ExecutionLink, HandoffOperation, StartHandoffRequest } from '@protocol';

export const ContinuityError = {
  NotFound: 'CONTINUITY_NOT_FOUND',
  InvalidDevice: 'CONTINUITY_INVALID_DEVICE',
  DeviceGenerationChanged: 'CONTINUITY_DEVICE_GENERATION_CHANGED',
  VersionConflict: 'CONTINUITY_VERSION_CONFLICT',
  OperationActive: 'CONTINUITY_OPERATION_ACTIVE',
  ReplayConflict: 'CONTINUITY_REPLAY_CONFLICT',
  SourceNotActive: 'CONTINUITY_SOURCE_NOT_ACTIVE',
  TargetMismatch: 'CONTINUITY_TARGET_MISMATCH',
  SeedNotDispatched: 'CONTINUITY_SEED_NOT_DISPATCHED',
  TargetNotReady: 'CONTINUITY_TARGET_NOT_READY',
  InvalidIdentifiers: 'CONTINUITY_INVALID_IDENTIFIERS',
  CommandIdReserved: 'CONTINUITY_COMMAND_ID_RESERVED',
  SeedProofMismatch: 'CONTINUITY_SEED_PROOF_MISMATCH',
  SeedIntentMismatch: 'CONTINUITY_SEED_INTENT_MISMATCH',
  InvalidPhase: 'CONTINUITY_INVALID_PHASE',
} as const;
export type ContinuityError = (typeof ContinuityError)[keyof typeof ContinuityError];

export const HandoffTerminalPhase = { Ready: 'ready', Failed: 'failed' } as const;
export type HandoffTerminalPhase = (typeof HandoffTerminalPhase)[keyof typeof HandoffTerminalPhase];
export const HandoffUnsuccessfulPhase = { Failed: 'failed', Unknown: 'unknown' } as const;
export type HandoffUnsuccessfulPhase =
  (typeof HandoffUnsuccessfulPhase)[keyof typeof HandoffUnsuccessfulPhase];
export const HandoffCommandKind = { Operation: 'operation', Create: 'create', Seed: 'seed' } as const;

export interface TrustedContinuityPrincipal {
  userId: string;
}

export interface InitialExecution {
  conversationId: string;
  id: string;
  provider: ExecutionLink['provider'];
  profileId: string;
  mode: ExecutionLink['mode'];
  nativeSessionId: string;
  generation: string;
}

export type StartHandoffInput = StartHandoffRequest;

export interface PersistHandoffInput extends StartHandoffInput {
  createCommandId: string;
  seedCommandId: string;
}

export interface ContinuityReadScope {
  deviceId: string;
  deviceGeneration: string;
}

export type ConversationRecord = Conversation;
export type ExecutionLinkRecord = ExecutionLink;
export type HandoffOperationRecord = HandoffOperation;
