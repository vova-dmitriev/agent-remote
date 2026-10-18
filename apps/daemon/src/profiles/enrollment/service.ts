import { randomBytes } from 'node:crypto';
import {
  CredentialEnrollmentAlgorithm,
  CredentialEnrollmentLimits,
  ErrorCode,
  ProfileAction,
  ProfileOperationPhase,
  ProfileStatus,
  beginEnrollmentSchema,
  enrollmentChallengeSchema,
  type BeginEnrollmentRequest,
  type EncryptedEnrollment,
} from '../../../../../packages/protocol/src/index.js';
import type { EnrollmentRecipient } from '../../../../../packages/transport/src/credentials/types.js';
import { immutableProfileScope } from '../storage/scope.js';
import { ProfileJournal } from '../lifecycle/journal.js';
import { loadEnrollmentIdentity } from './identity.js';
import { EnrollmentRepository } from './repository.js';
import { completeCredentialEnrollment } from './flow/complete.js';
import { reconcileCredentialEnrollment } from './flow/reconcile.js';
import { cancelEnrollmentForRemoval, enrollmentProfile } from './flow/state.js';
import type { EnrollmentContext } from './flow/types.js';
import type { CredentialEnrollmentOptions } from './types.js';

export class CredentialEnrollmentService {
  private identityPromise: Promise<EnrollmentRecipient> | undefined;
  private context: EnrollmentContext;

  constructor(options: CredentialEnrollmentOptions) {
    const configuration = { ...options, scope: immutableProfileScope(options.scope) };

    this.context = {
      options: configuration,
      repository: new EnrollmentRepository(configuration.database, configuration.scope),
      journal: new ProfileJournal(configuration.database, configuration.scope),
      identity: () => this.identity(),
      active: new Set(),
      now: options.now ?? Date.now,
    };
  }

  private identity() {
    return (this.identityPromise ??= loadEnrollmentIdentity(this.context.options.directory));
  }

  async recipient(current = () => true) {
    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    const identity = await this.identity();

    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    return {
      ...this.context.options.scope,
      version: CredentialEnrollmentLimits.Version,
      algorithm: CredentialEnrollmentAlgorithm.SealedBox,
      recipientKeyId: identity.keyId,
      recipientPublicKey: identity.publicKey,
    };
  }

  async begin(input: BeginEnrollmentRequest, current = () => true) {
    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    const request = beginEnrollmentSchema.parse(input);

    enrollmentProfile(this.context, request.profileId, request.expectedVersion);
    const recipient = await this.recipient(current);

    if (request.pinnedKeyId !== recipient.recipientKeyId) {
      throw new Error(ErrorCode.ENROLLMENT_KEY_UNTRUSTED);
    }

    this.context.journal.run(request, () => {
      const profile = enrollmentProfile(this.context, request.profileId, request.expectedVersion);
      const now = this.context.now();

      const challenge = enrollmentChallengeSchema.parse({
        ...recipient,
        profileId: profile.id,
        profileVersion: profile.version,
        operationId: request.operationId,
        challenge: randomBytes(32).toString('hex'),
        issuedAt: now,
        expiresAt: now + CredentialEnrollmentLimits.LifetimeMs,
      });

      this.context.repository.create(challenge, now);

      return {
        ...this.context.options.scope,
        id: request.operationId,
        profileId: profile.id,
        action: ProfileAction.EnrollApiKey,
        phase: ProfileOperationPhase.AwaitingAuthentication,
        profileVersion: profile.version,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });

    const saved = this.context.repository.get(request.operationId).challenge;

    if (saved.expiresAt <= this.context.now()) {
      throw new Error(ErrorCode.ENROLLMENT_EXPIRED);
    }

    return saved;
  }

  operation(id: string) {
    return this.context.journal.get(id);
  }

  forgetNativeCloseProof(id: string) {
    this.context.options.forgetNativeCloseProof?.(id);
  }

  complete(input: EncryptedEnrollment, current = () => true) {
    return completeCredentialEnrollment(this.context, input, current);
  }

  async cancelForRemoval(id: string) {
    const operation = this.context.journal.get(id);

    if (operation.action !== ProfileAction.EnrollApiKey) {
      throw new Error(ErrorCode.INVALID_REQUEST);
    }

    const profile = this.context.options.registry.get(operation.profileId);

    if (profile.status !== ProfileStatus.Removing && profile.status !== ProfileStatus.Removed) {
      throw new Error(ErrorCode.PROFILE_NOT_READY);
    }

    if (
      operation.phase === ProfileOperationPhase.Complete ||
      operation.phase === ProfileOperationPhase.Failed
    ) {
      return operation;
    }

    const proof = this.context.options.hasNativeCloseProof?.(id, profile.id, operation.profileVersion);

    if (!proof && !(await this.context.options.closeProfile?.(profile.id))) {
      throw new Error(ErrorCode.PROFILE_EXECUTION_ACTIVE);
    }

    const failed = cancelEnrollmentForRemoval(this.context, id);

    if (failed.phase === ProfileOperationPhase.Failed) {
      this.forgetNativeCloseProof(id);
    }

    return failed;
  }

  reconcile(id: string, current = () => true) {
    return reconcileCredentialEnrollment(this.context, id, current);
  }
}
