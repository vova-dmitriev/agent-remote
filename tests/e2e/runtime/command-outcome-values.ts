import { CommandStatus } from '../../../packages/protocol/src/index.js';

export const FixtureCommandOutcome = {
  Dispatched: CommandStatus.Dispatched,
  Unknown: CommandStatus.Unknown,
  Held: 'held',
} as const;

export type FixtureCommandOutcome = (typeof FixtureCommandOutcome)[keyof typeof FixtureCommandOutcome];
