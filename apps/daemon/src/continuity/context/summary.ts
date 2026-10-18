import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  CheckpointApprovalKind,
  CheckpointCoverage,
  contextCheckpointSummarySchema,
} from '../../../../../packages/protocol/src/index.js';
import type { CheckpointManualDecision } from './values.js';
import {
  assertCurrent,
  CheckpointError,
  CheckpointLimits,
  checkpointFailure,
  normalizeFence,
} from './values.js';
import type { CheckpointSource, LocalContextCheckpoint, SourceFence } from './types.js';
import { verifyAttachmentBlobs } from './attachments.js';
import { readPrivateFile } from './storage.js';

const validId = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);

export function checkpointDigest(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function previewDescriptor(
  draft: {
    id: string;
    source: SourceFence;
    coverage: LocalContextCheckpoint['coverage'];
    body: LocalContextCheckpoint['body'];
    estimatedTokens: number;
    missingMessageIds: string[];
    textTruncated: boolean;
    byteCount: number;
  },
  digest: string,
) {
  return {
    id: draft.id,
    digest,
    approved: false as const,
    sourceExecutionId: draft.source.executionId,
    sourceGeneration: draft.source.generation,
    historyWatermark: draft.source.historyWatermark,
    coverage: draft.coverage,
    messageCount: draft.body.messages.length,
    attachmentCount: draft.body.messages.reduce((total, message) => total + message.attachments.length, 0),
    estimatedTokens: draft.estimatedTokens,
    missingMessageIds: draft.missingMessageIds,
    textTruncated: draft.textTruncated,
    byteCount: draft.byteCount,
  };
}

export function approvedSummary(checkpoint: LocalContextCheckpoint) {
  return contextCheckpointSummarySchema.parse({
    id: checkpoint.id,
    sourceExecutionId: checkpoint.source.executionId,
    sourceGeneration: checkpoint.source.generation,
    historyWatermark: checkpoint.source.historyWatermark,
    digest: checkpoint.digest,
    createdAt: checkpoint.createdAt,
    coverage:
      checkpoint.coverage === 'complete' ? CheckpointCoverage.Complete : CheckpointCoverage.RecentWindow,
    messageCount: checkpoint.body.messages.length,
    attachmentCount: checkpoint.body.messages.reduce(
      (total, message) => total + message.attachments.length,
      0,
    ),
    estimatedTokens: checkpoint.estimatedTokens,
    approval: checkpoint.approval,
  });
}

export function manualApproval(decision: CheckpointManualDecision, now: number) {
  if (!decision || decision.kind !== CheckpointApprovalKind.Manual || !Number.isSafeInteger(now) || now < 0) {
    throw checkpointFailure(CheckpointError.ManualApprovalRequired);
  }

  return { kind: CheckpointApprovalKind.Manual, approvedAt: now } as const;
}

export function assertSummaryBudget(value: unknown, maxBytes: number) {
  if (typeof value !== 'string') {
    throw checkpointFailure(CheckpointError.SummaryInvalid);
  }

  if (Buffer.byteLength(value) > maxBytes) {
    throw checkpointFailure(CheckpointError.SizeLimit);
  }
}

export async function readDraft(directory: string, ownerId: string, id: string) {
  if (!validId(id)) {
    throw checkpointFailure(CheckpointError.IdInvalid);
  }

  const draft = JSON.parse(
    (await readPrivateFile(directory, `draft-${id}.json`, CheckpointLimits.MaxManifestBytes)).toString(
      'utf8',
    ),
  );

  if (draft.ownerId !== ownerId) {
    throw checkpointFailure(CheckpointError.OwnerMismatch);
  }

  const { digest, ...unsigned } = draft;

  if (checkpointDigest(unsigned) !== digest) {
    throw checkpointFailure(CheckpointError.DraftTampered);
  }

  return draft;
}

export async function readApprovedCheckpoint(
  directory: string,
  ownerId: string,
  id: string,
  expectedDigest: string,
  source: CheckpointSource,
): Promise<LocalContextCheckpoint> {
  if (!validId(id)) {
    throw checkpointFailure(CheckpointError.IdInvalid);
  }

  const initial = normalizeFence(await source.captureFence());

  if (initial.ownerId !== ownerId) {
    throw checkpointFailure(CheckpointError.OwnerMismatch);
  }

  let serialized: Buffer;

  try {
    serialized = await readPrivateFile(directory, `checkpoint-${id}.json`, CheckpointLimits.MaxManifestBytes);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw checkpointFailure(CheckpointError.NotApproved);
    }

    throw error;
  }

  assertCurrent(normalizeFence(await source.captureFence()), initial);
  const checkpoint = JSON.parse(serialized.toString('utf8')) as LocalContextCheckpoint;

  if (checkpoint.ownerId !== ownerId) {
    throw checkpointFailure(CheckpointError.OwnerMismatch);
  }

  assertCurrent(initial, checkpoint.source);
  const { digest, ...unsigned } = checkpoint;

  if (digest !== expectedDigest || checkpointDigest(unsigned) !== digest) {
    throw checkpointFailure(CheckpointError.DigestMismatch);
  }

  await verifyAttachmentBlobs(
    join(directory, 'attachments'),
    checkpoint.body.messages.flatMap((message) => message.attachments),
  );

  assertCurrent(normalizeFence(await source.captureFence()), checkpoint.source);

  return checkpoint;
}
