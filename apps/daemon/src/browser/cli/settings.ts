import { shellQuote } from '../../shell/index.js';
import { constants } from 'node:fs';
import { link, lstat, open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import { browserSettings } from '../../local/bootstrap/configuration.js';
import { missing, safeEntry, secureDirectory } from '../../local/supervisor/runtime.js';
import type { BrowserSettings } from './types.js';

export const wrapperPath = (directory: string) => join(directory, 'browser-native-host');

export function wrapperContents(directory: string, settings: BrowserSettings) {
  return `#!/bin/sh\nexec /usr/bin/env CLAUDE_REMOTE_HOME=${shellQuote(directory)} ${shellQuote(settings.runtime.nodePath)} ${shellQuote(settings.runtime.entryPath)} browser host "$@"\n`;
}

export async function readSettings(directory: string) {
  await secureDirectory(directory, true);

  try {
    return await browserSettings(directory);
  } catch {
    throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
  }
}

export async function requireSettings(directory: string) {
  const settings = await readSettings(directory);

  if (!settings) {
    throw new Error(ErrorCode.LOCAL_HOST_UNAVAILABLE);
  }

  return settings;
}

export async function ownedContents(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);

    safeEntry(stat, true);

    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) {
      throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    return await readFile(path, 'utf8');
  } catch (error) {
    if (missing(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function writeOwned(path: string, contents: string, mode: number) {
  await secureDirectory(dirname(path), true);
  const previous = await ownedContents(path);

  if (previous !== undefined) {
    if (previous !== contents || ((await lstat(path)).mode & 0o777) !== mode) {
      throw new Error(ErrorCode.LOCAL_RUNTIME_UNTRUSTED);
    }

    return;
  }

  const temporary = `${path}.${randomUUID()}.tmp`;

  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    mode,
  );

  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await link(temporary, path);
  } finally {
    await handle.close();
    await unlink(temporary);
  }
}
