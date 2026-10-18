import { ProfileOperationPhase } from '../../../../../packages/protocol/src/index.js';

export const ExecutionOwnershipKind = {
  Execution: 'execution',
  Mutation: 'mutation',
} as const;

export type ExecutionOwnershipKind = (typeof ExecutionOwnershipKind)[keyof typeof ExecutionOwnershipKind];

export const ExecutionChildState = {
  Exited: 'exited',
  Unverified: 'unverified',
  Unknown: 'unknown',
} as const;

export type ExecutionChildState = (typeof ExecutionChildState)[keyof typeof ExecutionChildState];

export const TerminalProfileOperationPhases = [
  ProfileOperationPhase.Complete,
  ProfileOperationPhase.Failed,
] as const;

export const ExecutionOwnershipTiming = { RetryMs: 50 } as const;
