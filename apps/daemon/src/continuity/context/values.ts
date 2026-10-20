import type { CheckpointMessage, ContextCheckpointDraft, SourceFence } from './types.js';
import { CheckpointCoverage, CodedError } from '@protocol';
import { CheckpointVisibleRole } from '../../domain/continuity/checkpoint.js';

export const CheckpointLimits = {
  MaxMessages: 500,
  MaxAttachments: 100,
  MaxManifestBytes: 2_000_000,
  MaxWorkingTreeBytes: 8_000,
  MaxMessageIdBytes: 256,
  MaxTextBytes: 64_000,
  MaxAttachmentBytes: 8_000_000,
} as const;

export const CheckpointDefaults = { PageSize: 50, MaxPages: 4, MaxBytes: 64_000 } as const;
export const CheckpointApprovalDecisionKind = { Manual: 'manual' } as const;
export type CheckpointManualDecision = { kind: typeof CheckpointApprovalDecisionKind.Manual };

export const CheckpointError = {
  SelectionInvalid: 'CHECKPOINT_SELECTION_INVALID',
  ConstraintsInvalid: 'CHECKPOINT_CONSTRAINTS_INVALID',
  PageLimitExceeded: 'CHECKPOINT_PAGE_LIMIT_EXCEEDED',
  PageCursorInvalid: 'CHECKPOINT_PAGE_CURSOR_INVALID',
  MetadataExceedsBudget: 'CHECKPOINT_METADATA_EXCEEDS_BUDGET',
  OwnerMismatch: 'CHECKPOINT_OWNER_MISMATCH',
  SourceChanged: 'CHECKPOINT_SOURCE_CHANGED',
  SourceScopeInvalid: 'CHECKPOINT_SOURCE_SCOPE_INVALID',
  AttachmentLimit: 'CHECKPOINT_ATTACHMENT_LIMIT',
  AttachmentSizeLimit: 'CHECKPOINT_ATTACHMENT_SIZE_LIMIT',
  AttachmentReferenceInvalid: 'CHECKPOINT_ATTACHMENT_REFERENCE_INVALID',
  AttachmentMissing: 'CHECKPOINT_ATTACHMENT_MISSING',
  AttachmentTampered: 'CHECKPOINT_ATTACHMENT_TAMPERED',
  LimitInvalid: 'CHECKPOINT_LIMIT_INVALID',
  PolicyApprovalUnsupported: 'CHECKPOINT_POLICY_APPROVAL_UNSUPPORTED',
  ManualApprovalRequired: 'CHECKPOINT_MANUAL_APPROVAL_REQUIRED',
  SummaryInvalid: 'CHECKPOINT_SUMMARY_INVALID',
  SizeLimit: 'CHECKPOINT_SIZE_LIMIT',
  IdInvalid: 'CHECKPOINT_ID_INVALID',
  NotApproved: 'CHECKPOINT_NOT_APPROVED',
  DigestMismatch: 'CHECKPOINT_DIGEST_MISMATCH',
  DraftTampered: 'CHECKPOINT_DRAFT_TAMPERED',
  StorageUnsafe: 'CHECKPOINT_STORAGE_UNSAFE',
  StorageSizeLimit: 'CHECKPOINT_STORAGE_SIZE_LIMIT',
} as const;
export type CheckpointError = (typeof CheckpointError)[keyof typeof CheckpointError];

export function checkpointFailure(code: CheckpointError) {
  return new CodedError(code);
}

export function checkpointCoverage(input: {
  missingMessageIds: readonly string[];
  missingAttachmentCount: number;
  stoppedAtPageLimit: boolean;
  textTruncated?: boolean;
}): CheckpointCoverage {
  return input.missingMessageIds.length ||
    input.missingAttachmentCount ||
    input.stoppedAtPageLimit ||
    input.textTruncated
    ? CheckpointCoverage.RecentWindow
    : CheckpointCoverage.Complete;
}

export function estimatedTokens(byteCount: number) {
  return Math.ceil(byteCount / 4);
}

export function draftDescriptor(input: Omit<ContextCheckpointDraft, 'approved'>): ContextCheckpointDraft {
  return { ...input, approved: false };
}

export const sameFence = (left: SourceFence, right: SourceFence) =>
  [
    'ownerId',
    'deviceId',
    'executionId',
    'generation',
    'historyWatermark',
    'repositoryRevision',
    'workingTree',
  ].every((key) => left[key as keyof SourceFence] === right[key as keyof SourceFence]);

export function normalizeFence(value: SourceFence): SourceFence {
  const string = (key: string, max: number) => {
    const item = (value as unknown as Record<string, unknown>)[key];

    if (typeof item !== 'string' || !item.length || item.length > max) {
      throw checkpointFailure(CheckpointError.SourceScopeInvalid);
    }

    return item;
  };

  const repositoryRevision = value.repositoryRevision;

  if (
    repositoryRevision !== null &&
    (typeof repositoryRevision !== 'string' || repositoryRevision.length > 512)
  ) {
    throw checkpointFailure(CheckpointError.SourceScopeInvalid);
  }

  return {
    ownerId: string('ownerId', CheckpointLimits.MaxMessageIdBytes),
    deviceId: string('deviceId', CheckpointLimits.MaxMessageIdBytes),
    executionId: string('executionId', CheckpointLimits.MaxMessageIdBytes),
    generation: string('generation', CheckpointLimits.MaxMessageIdBytes),
    historyWatermark: string('historyWatermark', CheckpointLimits.MaxMessageIdBytes),
    repositoryRevision,
    workingTree: string('workingTree', CheckpointLimits.MaxWorkingTreeBytes),
  };
}

export function cleanMessage(message: CheckpointMessage): CheckpointMessage {
  return {
    id: message.id.slice(0, CheckpointLimits.MaxMessageIdBytes),
    role: message.role,
    visible: true,
    text: message.text,
    attachments: (message.attachments ?? [])
      .filter((item) => typeof item?.id === 'string' && typeof item.path === 'string')
      .map((item) => ({
        id: item.id.slice(0, CheckpointLimits.MaxMessageIdBytes),
        path: item.path.slice(0, 4096),
      })),
  };
}

export function trimUtf8(value: string, maxBytes: number) {
  const trimmed = Buffer.from(value).subarray(0, maxBytes).toString('utf8');

  return trimmed.endsWith('\uFFFD') ? trimmed.slice(0, -1) : trimmed;
}

export function assertFence(value: SourceFence, ownerId: string) {
  if (value.ownerId !== ownerId) {
    throw checkpointFailure(CheckpointError.OwnerMismatch);
  }
}

export function assertCurrent(value: SourceFence, initial: SourceFence) {
  assertFence(value, initial.ownerId);

  if (!sameFence(value, initial)) {
    throw checkpointFailure(CheckpointError.SourceChanged);
  }
}

export function visibleMessage(message: CheckpointMessage) {
  return (
    message.visible &&
    (message.role === CheckpointVisibleRole.User || message.role === CheckpointVisibleRole.Assistant)
  );
}
