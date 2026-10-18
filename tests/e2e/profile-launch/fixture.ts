import { randomUUID } from 'node:crypto';
import {
  AgentProvider,
  ErrorCode,
  ProfileAction,
  ProfileAuthMode,
  ProfileRequestKind,
  ProfileStatus,
} from '../../../packages/protocol/src/index.js';
import type { RuntimeProfiles } from '../../../apps/daemon/src/profiles/runtime/service.js';

export async function readyLaunchProfile(runtime: RuntimeProfiles, label: string) {
  const created = await runtime.request({
    kind: ProfileRequestKind.Mutate,
    mutation: {
      action: ProfileAction.Create,
      operationId: randomUUID(),
      input: { label, provider: AgentProvider.Codex, authMode: ProfileAuthMode.Subscription },
    },
  });

  if (created.kind !== ProfileRequestKind.Mutate) {
    throw new Error(ErrorCode.INTERNAL_ERROR);
  }

  const listed = await runtime.request({ kind: ProfileRequestKind.List });

  if (listed.kind !== ProfileRequestKind.List) {
    throw new Error(ErrorCode.INTERNAL_ERROR);
  }

  const profile = listed.data.profiles.find((entry) => entry.id === created.data.profileId);

  if (!profile) {
    throw new Error(ErrorCode.NOT_FOUND);
  }

  const started = await runtime.request({
    kind: ProfileRequestKind.Authenticate,
    input: { action: ProfileAction.SignIn, operationId: randomUUID(), profileId: profile.id, expectedVersion: profile.version },
  });

  if (started.kind !== ProfileRequestKind.Authenticate) {
    throw new Error(ErrorCode.INTERNAL_ERROR);
  }

  await runtime.request({ kind: ProfileRequestKind.Reconcile, operationId: started.data.id });
  const verified = await runtime.request({ kind: ProfileRequestKind.List });

  if (verified.kind !== ProfileRequestKind.List) {
    throw new Error(ErrorCode.INTERNAL_ERROR);
  }

  const result = verified.data.profiles.find((entry) => entry.id === profile.id);

  if (!result || result.status !== ProfileStatus.Ready) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  return result;
}
