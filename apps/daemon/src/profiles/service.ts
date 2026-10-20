import {
  AgentProvider,
  CodedError,
  ErrorCode,
  hasErrorCode,
  ProfileAction,
  profileListSchema,
  type ProfileList,
  type ProfileMutation,
  profileMutationSchema,
  type ProfileOperation,
  ProfileOperationPhase,
} from '@protocol';
import { immutableProfileScope } from './storage/scope.js';
import { ProfileRegistry } from './registry.js';
import { ProfileJournal } from './lifecycle/journal.js';
import { mutateProfile } from './lifecycle/mutation.js';
import { removeProfileCredentials } from './lifecycle/cleanup.js';
import type { ProfileServiceOptions } from './lifecycle/types.js';

const profileListEnvelopeSchema = profileListSchema.omit({ profiles: true });

export class ProfileService {
  readonly registry: ProfileRegistry;
  private journal: ProfileJournal;

  constructor(private options: ProfileServiceOptions) {
    this.options = { ...options, scope: immutableProfileScope(options.scope) };
    this.registry = new ProfileRegistry(this.options.database, this.options.scope);
    this.journal = new ProfileJournal(this.options.database, this.options.scope);
  }

  list(): ProfileList {
    // Each profile is validated as it is read and the registry caps how many are active, so only the rest of the
    // list is parsed here: paging reads the whole list once per page.
    const profiles = this.registry.list();

    return {
      profiles,
      ...profileListEnvelopeSchema.parse({
        available: true,
        observedAt: Date.now(),
        operations: this.journal.pending(),
        defaults: {
          [AgentProvider.Claude]: this.registry.defaultFor(AgentProvider.Claude)?.id ?? null,
          [AgentProvider.Codex]: this.registry.defaultFor(AgentProvider.Codex)?.id ?? null,
        },
      }),
    };
  }

  operation(id: string) {
    return this.journal.get(id);
  }

  async execute(input: ProfileMutation, current = () => true): Promise<ProfileOperation> {
    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const request = profileMutationSchema.parse(input);

    if (
      request.action !== ProfileAction.Create &&
      request.action !== ProfileAction.Rename &&
      request.action !== ProfileAction.SetDefault &&
      request.action !== ProfileAction.Remove &&
      this.options.executionActive?.(request.profileId)
    ) {
      throw new CodedError(ErrorCode.PROFILE_EXECUTION_ACTIVE);
    }

    const result = this.journal.run(request, () => {
      const profile = mutateProfile(this.registry, request);
      const now = Date.now();

      return {
        ...this.options.scope,
        id: request.operationId,
        profileId: profile.id,
        action: request.action,
        phase:
          request.action === ProfileAction.Remove
            ? ProfileOperationPhase.Removing
            : ProfileOperationPhase.Complete,
        profileVersion: profile.version,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });

    return result.phase === ProfileOperationPhase.Removing ? this.reconcile(result.id, current) : result;
  }

  async reconcile(id: string, current = () => true): Promise<ProfileOperation> {
    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const operation = this.operation(id);

    if (operation.phase !== ProfileOperationPhase.Removing) {
      return operation;
    }

    const profile = this.registry.get(operation.profileId);

    try {
      await this.options.waitForInactive?.(profile.id, current);

      if (this.options.cleanup) {
        await this.options.cleanup(profile, current);
      } else {
        await removeProfileCredentials(this.options.directory, profile, current);
      }
    } catch (error) {
      if (!current()) {
        throw new CodedError(ErrorCode.UNAUTHORIZED);
      }

      const code =
        Object.values(ErrorCode).find((value) => hasErrorCode(error, value)) ?? ErrorCode.REQUEST_FAILED;

      return this.options.database.connection.transaction(() => {
        const latest = this.operation(id);

        return latest.phase === ProfileOperationPhase.Removing
          ? this.journal.save({ ...latest, code, version: latest.version + 1, updatedAt: Date.now() })
          : latest;
      })();
    }

    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    return this.options.database.connection.transaction(() => {
      const latest = this.operation(id);

      if (latest.phase !== ProfileOperationPhase.Removing) {
        return latest;
      }

      const removed = this.registry.completeRemoval(profile.id, operation.profileVersion);

      return this.journal.save({
        ...latest,
        code: undefined,
        phase: ProfileOperationPhase.Complete,
        profileVersion: removed.version,
        version: latest.version + 1,
        updatedAt: Date.now(),
      });
    })();
  }
}
