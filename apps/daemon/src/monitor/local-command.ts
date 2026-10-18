import { createHash } from 'node:crypto';
import type Sqlite from 'better-sqlite3';
import {
  ErrorCode,
  LOCAL_LIMITS,
  clientCommandSchema,
  type ClientCommand,
  type Command,
} from '../../../../packages/protocol/src/index.js';

interface IntentReservation {
  fingerprint: string;
  expiresAt: number;
}

const fingerprint = (command: ClientCommand) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');

export function localCommand(db: Sqlite.Database, raw: ClientCommand): Command {
  const command = clientCommandSchema.parse(raw);
  const hash = fingerprint(command);

  return db.transaction(() => {
    const row = db.prepare('SELECT data FROM local_command_intents WHERE id=?').get(command.commandId) as
      { data: string } | undefined;

    if (row) {
      const saved = JSON.parse(row.data) as IntentReservation | Command;

      const original =
        'fingerprint' in saved ? saved.fingerprint : fingerprint(clientCommandSchema.parse(saved));

      if (original !== hash) {
        throw new Error(ErrorCode.COMMAND_ID_REUSED);
      }

      if (!Number.isFinite(saved.expiresAt)) {
        throw new Error(ErrorCode.COMMAND_STORE_UNAVAILABLE);
      }

      return { ...command, version: LOCAL_LIMITS.protocolVersion, expiresAt: saved.expiresAt };
    }

    const count = db.prepare('SELECT count(*) AS count FROM local_command_intents').get() as {
      count: number;
    };

    if (count.count >= LOCAL_LIMITS.maxCommandIntents) {
      throw new Error(ErrorCode.COMMAND_STORE_UNAVAILABLE);
    }

    const expiresAt = Date.now() + LOCAL_LIMITS.requestTimeoutMs;

    db.prepare('INSERT INTO local_command_intents VALUES(?,?,?)').run(
      command.commandId,
      JSON.stringify({ fingerprint: hash, expiresAt }),
      Date.now(),
    );

    return { ...command, version: LOCAL_LIMITS.protocolVersion, expiresAt };
  })();
}
