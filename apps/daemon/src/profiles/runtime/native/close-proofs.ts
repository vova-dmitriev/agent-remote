import { CodedError, ErrorCode, ProfileLimits } from '@protocol';
import { RuntimeProfileCloseProofStatus } from './close-proof-values.js';
import type { RuntimeProfileCloseProof } from '../types.js';

export class RuntimeProfileCloseProofs {
  private proofs = new Map<string, RuntimeProfileCloseProof>();

  constructor(private limit: number = ProfileLimits.Operations) {}

  reserve(operationId: string, profileId: string, profileVersion: number) {
    const existing = this.proofs.get(operationId);

    if (existing && (existing.profileId !== profileId || existing.profileVersion !== profileVersion)) {
      throw new CodedError(ErrorCode.PROFILE_OPERATION_REUSED);
    }

    if (!existing && this.proofs.size >= this.limit) {
      throw new CodedError(ErrorCode.PROFILE_LIMIT_REACHED);
    }

    this.proofs.set(operationId, {
      profileId,
      profileVersion,
      status: RuntimeProfileCloseProofStatus.Pending,
    });
  }

  confirm(operationId: string, profileId: string, profileVersion: number) {
    this.proofs.set(operationId, {
      profileId,
      profileVersion,
      status: RuntimeProfileCloseProofStatus.Closed,
    });
  }

  has(operationId: string, profileId: string, profileVersion: number) {
    const proof = this.proofs.get(operationId);

    return Boolean(
      proof &&
      proof.status === RuntimeProfileCloseProofStatus.Closed &&
      proof.profileId === profileId &&
      proof.profileVersion === profileVersion,
    );
  }

  forget(operationId: string) {
    this.proofs.delete(operationId);
  }
}
