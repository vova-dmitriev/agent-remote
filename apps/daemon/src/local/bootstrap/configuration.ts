import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { configSchema, type DaemonConfig } from '../../config.js';
import { ErrorCode } from '@protocol';
import { loadLocalIdentity } from './identity.js';

export async function runtimeConfiguration(directory: string) {
  let relay: DaemonConfig | null = null;

  try {
    relay = configSchema.parse(JSON.parse(await readFile(join(directory, 'device.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const identity = await loadLocalIdentity(directory, relay?.deviceId);

  return { ...identity, relay };
}

export const browserSettingsSchema = z.strictObject({
  origins: z
    .array(z.string().regex(/^chrome-extension:\/\/[a-p]{32}\/$/))
    .min(1)
    .max(32),
  runtime: z.strictObject({
    nodePath: z.string().min(1),
    entryPath: z.string().min(1),
    nodeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    entrySha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

export async function browserSettings(directory: string) {
  const path = join(directory, 'browser-settings.json');

  try {
    const info = await lstat(path);

    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 65536 ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    return browserSettingsSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
