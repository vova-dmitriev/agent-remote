import { createHash } from 'node:crypto';
import { mkdir, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import {
  ErrorCode,
  ProfileStatus,
  type ExecutionProfileSummary,
} from '../../../../../packages/protocol/src/index.js';
import { managedCodexSocketPath } from '../../codex/launch/paths.js';
import { ProfileExecutionSocket } from './values.js';

export async function profileExecutionNamespace(
  profile: ExecutionProfileSummary,
  root: string = ProfileExecutionSocket.Root,
) {
  const uid = process.getuid?.();

  if (uid === undefined) {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  if (profile.status !== ProfileStatus.Ready || !profile.identity) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  const key = createHash('sha256')
    .update(
      JSON.stringify([
        profile.ownerId,
        profile.deviceId,
        profile.id,
        profile.provider,
        profile.authMode,
        profile.identity.accountRef,
        profile.identity.workspaceRef,
      ]),
    )
    .digest('hex')
    .slice(0, ProfileExecutionSocket.HashLength);

  const directory = join(root, ProfileExecutionSocket.Prefix + uid + '-' + key);
  const socketPath = managedCodexSocketPath(directory);

  if (!isAbsolute(root) || Buffer.byteLength(socketPath) > ProfileExecutionSocket.MaxPathBytes) {
    throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
  }

  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  const info = await lstat(directory);

  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
  }

  return { directory, socketPath };
}
