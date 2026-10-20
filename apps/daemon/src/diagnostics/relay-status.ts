import { ErrorCode } from '@protocol';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Why the running companion last stopped talking to its relay, for `remote status`. The companion clears it when it
 * starts, when it connects and when it stops cleanly; the recorded pid tells a live record from a crashed one.
 */
const RelayStatusFile = { Name: 'relay-status.json', MaxBytes: 1024, Mode: 0o600 } as const;

const relayStatusSchema = z.strictObject({
  code: z.enum(ErrorCode),
  at: z.number().int().nonnegative(),
  pid: z.number().int().positive(),
});

export type RelayStatus = z.infer<typeof relayStatusSchema>;

/** Records the relay stop reason for this process, or clears it with `null`. */
export async function saveRelayStatus(directory: string, code: ErrorCode | null, now = Date.now()) {
  const path = join(directory, RelayStatusFile.Name);

  if (code === null) {
    await rm(path, { force: true });

    return;
  }

  const temp = path + '.' + randomBytes(8).toString('hex');
  const record = relayStatusSchema.parse({ code, at: now, pid: process.pid });

  await writeFile(temp, JSON.stringify(record), { mode: RelayStatusFile.Mode, flag: 'wx' });
  await rename(temp, path);
  await chmod(path, RelayStatusFile.Mode);
}

/**
 * The recorded relay stop reason, read like `local.key`: never through a symlink, owned by the user, 0600 and small.
 * An absent, foreign or unreadable record means none.
 */
export async function readRelayStatus(directory: string): Promise<RelayStatus | undefined> {
  let handle: FileHandle;

  try {
    handle = await open(join(directory, RelayStatusFile.Name), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    // No record, or a symlink in its place: no stop reason.
    return undefined;
  }

  try {
    const info = await handle.stat();

    if (
      !info.isFile() ||
      (process.getuid && info.uid !== process.getuid()) ||
      (info.mode & 0o777) !== RelayStatusFile.Mode ||
      info.size > RelayStatusFile.MaxBytes
    ) {
      return undefined;
    }

    const parsed = relayStatusSchema.safeParse(JSON.parse(await handle.readFile('utf8')));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/** Whether the process that wrote a record still runs; a record from a crashed companion is stale. */
export function relayStatusIsLive(status: RelayStatus): boolean {
  try {
    process.kill(status.pid, 0);

    return true;
  } catch {
    // ESRCH: no such process. EPERM: the pid now belongs to another user, so it is not this user's companion.
    return false;
  }
}
