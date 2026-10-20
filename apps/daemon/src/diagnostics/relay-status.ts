import { ErrorCode } from '@protocol';
import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** Why the companion last stopped talking to its relay, for `remote status`; absent while it connects normally. */
const RELAY_STATUS_FILE = 'relay-status.json';
const relayStatusSchema = z.strictObject({ code: z.enum(ErrorCode) });

/** Records the relay stop reason, or clears it with `null`. */
export async function saveRelayStatus(directory: string, code: ErrorCode | null) {
  const path = join(directory, RELAY_STATUS_FILE);

  if (code === null) {
    await rm(path, { force: true });

    return;
  }

  const temp = path + '.' + randomBytes(8).toString('hex');

  await writeFile(temp, JSON.stringify(relayStatusSchema.parse({ code })), { mode: 0o600 });
  await rename(temp, path);
}

/** The recorded relay stop reason; an absent or unreadable record means none. */
export async function readRelayStatus(directory: string): Promise<ErrorCode | undefined> {
  try {
    return relayStatusSchema.parse(JSON.parse(await readFile(join(directory, RELAY_STATUS_FILE), 'utf8')))
      .code;
  } catch {} // ignore: no record, or one this build cannot read, reports no stop reason
}
