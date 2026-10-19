import {
  AgentProvider,
  CodedError,
  ErrorCode,
  ProfileAction,
  type ProfileAuthenticationRequest,
  profileAuthenticationSchema,
  ProfileAuthMode,
  type ProfileLogin,
  type ProfileOperation,
  ProfileOperationPhase,
  ProfileStatus,
} from '@protocol';
import { startProfileAuthentication } from './flow/start.js';
import { reconcileProfileAuthentication } from './flow/reconcile.js';
import { authenticationOptions } from './options.js';
import { ProfileJournal } from '../lifecycle/journal.js';
import { ProfileAuthenticationPool } from './pool.js';
import {
  assertProfileCaller,
  authenticationProfile,
  saveAuthentication,
  discardProfileLogins,
} from './state.js';
import type { ProfileAuthenticationOptions } from './types.js';

export class ProfileAuthentication {
  private journal: ProfileJournal;
  private pool: ProfileAuthenticationPool;
  private active = new Set<string>();
  private starting = new Map<string, Promise<boolean>>();
  private logins = new Map<string, ProfileLogin>();
  private options: ProfileAuthenticationOptions;

  constructor(options: ProfileAuthenticationOptions) {
    this.options = authenticationOptions(options);
    this.journal = new ProfileJournal(options.database, this.options.scope);
    this.pool = new ProfileAuthenticationPool(this.options);
  }

  operation(id: string) {
    return this.journal.get(id);
  }

  async execute(input: ProfileAuthenticationRequest, current = () => true) {
    assertProfileCaller(current);
    const request = profileAuthenticationSchema.parse(input);
    let created = false;

    const operation = this.journal.run(request, () => {
      let profile = authenticationProfile(this.options, request.profileId, request.expectedVersion);

      if (
        profile.provider !== AgentProvider.Codex ||
        (request.action === ProfileAction.SignIn && profile.authMode !== ProfileAuthMode.Subscription)
      ) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      if (request.action === ProfileAction.SignIn) {
        profile = this.options.registry.authenticationRequired(profile.id, profile.version);
      }

      created = true;
      const now = Date.now();

      return {
        ...this.options.scope,
        id: request.operationId,
        profileId: profile.id,
        profileVersion: profile.version,
        action: request.action,
        phase: ProfileOperationPhase.Preparing,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });

    if (!created) {
      return { operation, login: this.logins.get(operation.id) };
    }

    if (operation.action === ProfileAction.Check) {
      return { operation: await this.reconcile(operation.id, current) };
    }

    return startProfileAuthentication(
      {
        options: this.options,
        pool: this.pool,
        journal: this.journal,
        logins: this.logins,
        active: this.active,
        starting: this.starting,
        closeProfile: (id) => this.closeProfile(id),
      },
      operation,
      current,
    );
  }

  async reconcile(id: string, current = () => true): Promise<ProfileOperation> {
    assertProfileCaller(current);
    const operation = this.journal.get(id);

    if (
      this.active.has(id) ||
      (operation.phase !== ProfileOperationPhase.Preparing &&
        operation.phase !== ProfileOperationPhase.AwaitingAuthentication)
    ) {
      return operation;
    }

    if (operation.action !== ProfileAction.SignIn && operation.action !== ProfileAction.Check) {
      throw new CodedError(ErrorCode.INVALID_REQUEST);
    }

    this.active.add(id);

    try {
      return await reconcileProfileAuthentication(
        { options: this.options, pool: this.pool, journal: this.journal, logins: this.logins },
        operation,
        current,
      );
    } finally {
      this.active.delete(id);
    }
  }

  async closeProfile(id: string) {
    discardProfileLogins(this.journal, this.logins, id);
    await this.pool.close(id);
  }

  async cancelForRemoval(id: string): Promise<ProfileOperation> {
    const operation = this.journal.get(id);

    if (operation.action !== ProfileAction.SignIn && operation.action !== ProfileAction.Check) {
      throw new CodedError(ErrorCode.INVALID_REQUEST);
    }

    const profile = this.options.registry.get(operation.profileId);

    if (profile.status !== ProfileStatus.Removing && profile.status !== ProfileStatus.Removed) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    if (
      operation.phase === ProfileOperationPhase.Complete ||
      operation.phase === ProfileOperationPhase.Failed
    ) {
      return operation;
    }

    if (!(await this.pool.close(profile.id, operation.profileVersion))) {
      const startup = this.starting.get(id);

      if (!startup || !(await startup)) {
        throw new CodedError(ErrorCode.PROFILE_EXECUTION_ACTIVE);
      }

      await this.pool.close(profile.id, operation.profileVersion);
    }

    this.logins.delete(id);

    return this.options.database.connection.transaction(() => {
      const latest = this.journal.get(id);

      if (latest.phase === ProfileOperationPhase.Complete || latest.phase === ProfileOperationPhase.Failed) {
        return latest;
      }

      const currentProfile = this.options.registry.get(latest.profileId);

      if (
        currentProfile.status !== ProfileStatus.Removing &&
        currentProfile.status !== ProfileStatus.Removed
      ) {
        throw new CodedError(ErrorCode.PROFILE_NOT_READY);
      }

      return saveAuthentication(
        this.journal,
        latest,
        ProfileOperationPhase.Failed,
        ErrorCode.PROFILE_NOT_READY,
      );
    })();
  }

  async close() {
    this.logins.clear();
    await this.pool.closeAll();
  }
}
