import { CodedError } from '@protocol';

export const CheckpointSourceError = {
  BindingInvalid: 'CHECKPOINT_SOURCE_BINDING_INVALID',
  Busy: 'CHECKPOINT_SOURCE_BUSY',
  HistoryUnavailable: 'CHECKPOINT_SOURCE_HISTORY_UNAVAILABLE',
  RepositoryUnavailable: 'CHECKPOINT_SOURCE_REPOSITORY_UNAVAILABLE',
  RepositoryBudgetExceeded: 'CHECKPOINT_SOURCE_REPOSITORY_BUDGET_EXCEEDED',
  AttachmentUnavailable: 'CHECKPOINT_SOURCE_ATTACHMENT_UNAVAILABLE',
  AttachmentSizeLimit: 'CHECKPOINT_SOURCE_ATTACHMENT_SIZE_LIMIT',
} as const;
export type CheckpointSourceError = (typeof CheckpointSourceError)[keyof typeof CheckpointSourceError];

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);

    return code < 32 || code === 127;
  });
}

export const NativeCheckpointSourceLimits = {
  PageSize: 30,
  GitOutputBytes: 256_000,
  GitFileEntries: 8192,
  GitTimeoutMs: 2000,
} as const;

export const RepositoryFenceScope = {
  GitVisibleMetadataV1: 'git-visible-metadata-v1',
} as const;
export type RepositoryFenceScope = (typeof RepositoryFenceScope)[keyof typeof RepositoryFenceScope];

export function sourceFailure(code: CheckpointSourceError) {
  return new CodedError(code);
}
