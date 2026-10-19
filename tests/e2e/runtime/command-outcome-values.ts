import { CommandStatus } from '@protocol';

export const FixtureCommandOutcome = {
  Dispatched: CommandStatus.Dispatched,
  Unknown: CommandStatus.Unknown,
  Held: 'held',
} as const;

export type FixtureCommandOutcome = (typeof FixtureCommandOutcome)[keyof typeof FixtureCommandOutcome];
