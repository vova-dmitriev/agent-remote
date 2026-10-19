import { expect } from '@playwright/test';
import { delivered, deviceFixture } from '../support/relay-fixture.js';
import { CommandStatus, FrameType } from '@protocol';
import { FixtureCommandOutcome } from './command-outcome-values.js';

let outcome: FixtureCommandOutcome = FixtureCommandOutcome.Dispatched;

export function commandOutcome() {
  return outcome;
}

export function setCommandOutcome(status: typeof outcome) {
  outcome = status;
}

export async function releaseCommandOutcome() {
  const { sockets, relay } = deviceFixture();
  const command = delivered.at(-1);

  if (!command) throw new Error('NO_SYNTHETIC_COMMAND');

  sockets[0]!.send(
    JSON.stringify({
      type: FrameType.CommandResult,
      result: { commandId: command.commandId, status: CommandStatus.Dispatched },
    }),
  );

  await expect
    .poll(
      async () =>
        (
          await relay.db.pool.query('SELECT status FROM command_audit WHERE command_id=$1', [
            command.commandId,
          ])
        ).rows[0]?.status,
    )
    .toBe(CommandStatus.Dispatched);
}
