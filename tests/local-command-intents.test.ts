import { afterEach, expect, it } from 'vitest';
import Sqlite from 'better-sqlite3';
import { localCommand } from '../apps/daemon/src/monitor/local/local-command.js';
import { CommandActionType, ErrorCode, LOCAL_LIMITS, type ClientCommand } from '@protocol';
import { localFixture } from './helpers/local-runtime.js';

const database = new Sqlite(':memory:');

database.exec(
  'CREATE TABLE local_command_intents(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at INTEGER NOT NULL)',
);

afterEach(() => database.exec('DELETE FROM local_command_intents'));

async function intent() {
  const f = localFixture();

  const command: ClientCommand = {
    commandId: 'stable-intent',
    target: f.session.target,
    sessionId: f.session.id,
    generation: f.session.generation,
    action: { type: CommandActionType.Prompt, text: 'Synthetic private prompt body' },
  };

  await f.close();

  return command;
}

it('persists only a bounded fingerprint reservation and stable expiry, without duplicate prompt text', async () => {
  const command = await intent();
  const first = localCommand(database, command);
  const stored = database.prepare('SELECT data FROM local_command_intents').get() as { data: string };

  expect(stored.data).not.toContain(
    command.action.type === CommandActionType.Prompt ? command.action.text : '',
  );

  expect(localCommand(database, command)).toEqual(first);

  await expect(async () =>
    localCommand(database, { ...command, action: { type: CommandActionType.Prompt, text: 'Changed' } }),
  ).rejects.toThrow(ErrorCode.COMMAND_ID_REUSED);
});

it('fails closed at the reservation count limit but still reconciles an existing ID', async () => {
  const command = await intent();
  const first = localCommand(database, command);
  const data = (database.prepare('SELECT data FROM local_command_intents').get() as { data: string }).data;

  database.transaction(() => {
    const insert = database.prepare('INSERT INTO local_command_intents VALUES(?,?,0)');

    for (let i = 1; i < LOCAL_LIMITS.maxCommandIntents; i++) {
      insert.run('filler-' + i, data);
    }
  })();

  expect(() => localCommand(database, { ...command, commandId: 'over-limit' })).toThrow(
    ErrorCode.COMMAND_STORE_UNAVAILABLE,
  );

  expect(localCommand(database, command)).toEqual(first);
});
