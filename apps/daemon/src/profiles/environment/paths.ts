import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { z } from 'zod';
import { CodedError, ErrorCode } from '@protocol';
import type { ProfileScope } from '../types.js';
import { ProfileDirectoryName, ProfileCredentialLimits, ProfileRuntimeFile } from './values.js';
import type { ProfileHomes } from './types.js';

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  });

  const info = await lstat(path);

  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  await chmod(path, 0o700);
}

export async function profileHomes(
  directory: string,
  scope: ProfileScope,
  profileId: string,
): Promise<ProfileHomes> {
  z.uuid().parse(profileId);

  if (!isAbsolute(directory)) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  await privateDirectory(directory);
  const root = await realpath(directory);

  const partition = createHash('sha256')
    .update(JSON.stringify([scope.ownerId, scope.deviceId]))
    .digest('hex');

  let path = root;

  for (const segment of [ProfileDirectoryName.Profiles, partition, profileId]) {
    path = join(path, segment);
    await privateDirectory(path);
  }

  const homes = {
    home: join(path, ProfileDirectoryName.Home),
    codex: join(path, ProfileDirectoryName.Codex),
    claude: join(path, ProfileDirectoryName.Claude),
    temporary: join(path, ProfileDirectoryName.Temporary),
    config: join(path, ProfileDirectoryName.Home, ProfileDirectoryName.Config),
    cache: join(path, ProfileDirectoryName.Home, ProfileDirectoryName.Cache),
  };

  for (const child of Object.values(homes)) {
    await privateDirectory(child);
  }

  await validateCredentialFile(join(homes.codex, ProfileRuntimeFile.CodexCredentials));

  return homes;
}

async function validateCredentialFile(path: string) {
  try {
    const info = await lstat(path);

    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > ProfileCredentialLimits.MaxFileBytes ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
