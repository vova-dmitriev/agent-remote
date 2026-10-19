import { createHash } from 'node:crypto';
import {
  CodedError,
  type EncryptedEnrollment,
  encryptedEnrollmentSchema,
  ErrorCode,
  ProfileOperationPhase,
} from '@protocol';
import { decryptEnrollment } from '@transport/credentials/sealed-box.js';
import { credentialReference } from '../../credentials.js';
import { enrollmentProfile, finishEnrollment, uncertainEnrollment } from './state.js';
import type { EnrollmentContext } from './types.js';

export async function completeCredentialEnrollment(
  context: EnrollmentContext,
  input: EncryptedEnrollment,
  current: () => boolean,
) {
  if (!current()) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  const envelope = encryptedEnrollmentSchema.parse(input);
  const record = context.repository.get(envelope.operationId);
  const cipherHash = createHash('sha256').update(envelope.ciphertext).digest('hex');

  if (record.consumed) {
    if (record.cipherHash !== cipherHash) {
      throw new CodedError(ErrorCode.ENROLLMENT_REPLAYED);
    }

    return context.journal.get(envelope.operationId);
  }

  const body = await decryptEnrollment(envelope, record.challenge, await context.identity(), context.now());

  try {
    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const transition = context.options.database.connection.transaction(() => {
      const latest = context.repository.get(envelope.operationId);

      if (latest.consumed) {
        if (latest.cipherHash !== cipherHash) {
          throw new CodedError(ErrorCode.ENROLLMENT_REPLAYED);
        }

        return { operation: context.journal.get(envelope.operationId), apply: false };
      }

      const profile = enrollmentProfile(context, body.profileId, body.profileVersion);

      const accepted = context.repository.consume(
        envelope.operationId,
        cipherHash,
        credentialReference(profile.provider, body.apiKey),
      );

      if (!accepted) {
        return { operation: context.journal.get(envelope.operationId), apply: false };
      }

      const pending = context.options.registry.authenticationRequired(profile.id, profile.version);
      const operation = context.journal.get(envelope.operationId);

      return {
        operation: context.journal.save({
          ...operation,
          phase: ProfileOperationPhase.Preparing,
          profileVersion: pending.version,
          version: operation.version + 1,
          updatedAt: context.now(),
        }),
        apply: true,
      };
    })();

    if (!transition.apply) {
      return transition.operation;
    }

    context.active.add(envelope.operationId);

    try {
      const profile = context.options.registry.get(body.profileId);
      const evidence = await context.options.apply(body.apiKey, profile, current, envelope.operationId);

      if (!current()) {
        throw new CodedError(ErrorCode.UNAUTHORIZED);
      }

      return finishEnrollment(context, envelope.operationId, evidence);
    } catch (error) {
      if (!current()) {
        throw new CodedError(ErrorCode.UNAUTHORIZED);
      }

      return uncertainEnrollment(context, envelope.operationId, error);
    } finally {
      context.active.delete(envelope.operationId);
    }
  } finally {
    body.apiKey = '';
  }
}
