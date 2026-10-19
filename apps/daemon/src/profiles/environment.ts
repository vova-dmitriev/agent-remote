import { join } from 'node:path';
import { ErrorCode, ProfileStatus } from '@protocol';
import { privateFile } from '../local/bootstrap/private-file.js';
import type { ProfileRegistry } from './registry.js';
import { profileHomes } from './environment/paths.js';
import {
  CodexProfileConfiguration,
  PreservedProfileEnvironment,
  ProfileEnvironmentPurpose,
  ProfileRuntimeFile,
} from './environment/values.js';
import type { ProfileEnvironmentOptions } from './environment/types.js';

export async function buildProfileEnvironment(
  registry: ProfileRegistry,
  profileId: string,
  options: ProfileEnvironmentOptions,
): Promise<NodeJS.ProcessEnv> {
  const profile = registry.get(profileId);
  const purpose = options.purpose ?? ProfileEnvironmentPurpose.Execution;

  const eligible =
    profile.status === ProfileStatus.Ready ||
    (purpose === ProfileEnvironmentPurpose.Enrollment &&
      profile.status === ProfileStatus.NeedsAuthentication);

  if (!eligible) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  const homes = await profileHomes(options.directory, profile, profile.id);

  const configuration = await privateFile(
    join(homes.codex, ProfileRuntimeFile.CodexConfig),
    () => CodexProfileConfiguration,
  );

  if (configuration !== CodexProfileConfiguration) {
    throw new Error(ErrorCode.PROFILE_MISMATCH);
  }

  if (registry.get(profileId).version !== profile.version) {
    throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
  }

  const environment: NodeJS.ProcessEnv = {};

  for (const key of Object.values(PreservedProfileEnvironment)) {
    if (options.base[key] !== undefined) {
      environment[key] = options.base[key];
    }
  }

  return {
    ...environment,
    HOME: homes.home,
    CODEX_HOME: homes.codex,
    CODEX_SQLITE_HOME: homes.codex,
    CLAUDE_CONFIG_DIR: homes.claude,
    TMPDIR: homes.temporary,
    XDG_CONFIG_HOME: homes.config,
    XDG_CACHE_HOME: homes.cache,
  };
}
