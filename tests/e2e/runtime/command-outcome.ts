import { expect } from '@playwright/test';
import { delivered, deviceFixture } from '../support/relay-fixture.js';

let outcome: 'dispatched' | 'unknown' | 'held' = 'dispatched';

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
      type: 'command_result',
      result: { commandId: command.commandId, status: 'dispatched' },
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
    .toBe('dispatched');
}
