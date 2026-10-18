import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentProvider,
  ErrorCode,
  type ExecutionProfileSummary,
} from '../../../../../packages/protocol/src/index.js';
import { profileHomes } from '../environment/paths.js';
import { ProfileRuntimeFile } from '../environment/values.js';

export async function removeProfileCredentials(
  directory: string,
  profile: ExecutionProfileSummary,
  current: () => boolean,
) {
  if (profile.provider !== AgentProvider.Codex) {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  const homes = await profileHomes(directory, profile, profile.id);

  if (!current()) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  await unlink(join(homes.codex, ProfileRuntimeFile.CodexCredentials)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    },
  );
}
