import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { collectContext } from './collector.js';
import { persistAttachment } from './storage/attachments.js';
import { ensurePrivateDirectory, writePrivateFile } from './storage/storage.js';
import {
  assertCurrent,
  CheckpointDefaults,
  CheckpointError,
  CheckpointLimits,
  checkpointFailure,
  estimatedTokens,
  normalizeFence,
} from './values.js';
import {
  approvedSummary,
  assertSummaryBudget,
  checkpointDigest,
  manualApproval,
  readApprovedCheckpoint,
  readDraft,
  previewDescriptor,
} from './summary.js';
import type {
  CheckpointManagerOptions,
  CheckpointSelection,
  CheckpointSource,
  ContextCheckpointDraft,
  LocalContextCheckpoint,
} from './types.js';
import type { CheckpointManualDecision } from './values.js';

export class ContextCheckpointManager {
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly maxBytes: number;
  private readonly maxAttachmentBytes: number;
  private readonly maxMessages: number;

  constructor(private readonly options: CheckpointManagerOptions) {
    this.pageSize = options.pageSize ?? CheckpointDefaults.PageSize;
    this.maxPages = options.maxPages ?? CheckpointDefaults.MaxPages;
    this.maxBytes = options.maxBytes ?? CheckpointDefaults.MaxBytes;
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? CheckpointLimits.MaxAttachmentBytes;
    this.maxMessages = options.maxMessages ?? CheckpointLimits.MaxMessages;

    if (
      ![this.pageSize, this.maxPages, this.maxBytes, this.maxMessages].every(Number.isSafeInteger) ||
      this.pageSize < 1 ||
      this.maxPages < 1 ||
      this.maxBytes < 1 ||
      this.maxMessages < 1 ||
      this.maxMessages > CheckpointLimits.MaxMessages ||
      !Number.isSafeInteger(this.maxAttachmentBytes) ||
      this.maxAttachmentBytes < 1 ||
      this.maxAttachmentBytes > CheckpointLimits.MaxAttachmentBytes
    ) {
      throw checkpointFailure(CheckpointError.LimitInvalid);
    }
  }

  async prepareCheckpoint(
    source: CheckpointSource,
    selection: CheckpointSelection,
  ): Promise<ContextCheckpointDraft> {
    await ensurePrivateDirectory(this.options.directory);

    const collected = await collectContext({
      source,
      selection,
      expectedOwnerId: this.options.ownerId,
      pageSize: this.pageSize,
      maxPages: this.maxPages,
      maxBytes: this.maxBytes,
      maxMessages: this.maxMessages,
      persistAttachment: (reference) =>
        persistAttachment(
          join(this.options.directory, 'attachments'),
          reference,
          (ref) => source.readAttachment(ref, this.maxAttachmentBytes),
          this.maxAttachmentBytes,
        ),
    });

    assertCurrent(normalizeFence(await source.captureFence()), collected.source);

    const draft = {
      version: 1 as const,
      id: collected.id,
      ownerId: this.options.ownerId,
      source: collected.source,
      selectedMessageIds: collected.selectedMessageIds,
      coverage: collected.coverage,
      estimatedTokens: collected.estimatedTokens,
      body: collected.body,
      missingMessageIds: collected.missingMessageIds,
      textTruncated: collected.textTruncated,
      byteCount: collected.byteCount,
      createdAt: Date.now(),
    };

    const digest = checkpointDigest(draft);

    await writePrivateFile(
      this.options.directory,
      `draft-${draft.id}.json`,
      Buffer.from(JSON.stringify({ ...draft, digest })),
      CheckpointLimits.MaxManifestBytes,
    );

    try {
      assertCurrent(normalizeFence(await source.captureFence()), collected.source);
    } catch (error) {
      await unlink(join(this.options.directory, `draft-${draft.id}.json`));
      throw error;
    }

    return previewDescriptor(draft, digest);
  }

  async finalizeCheckpoint(
    id: string,
    editedSummary: string,
    approval: CheckpointManualDecision,
    expectedDraftDigest: string,
    source: CheckpointSource,
  ) {
    const draft = await readDraft(this.options.directory, this.options.ownerId, id);

    if (draft.digest !== expectedDraftDigest) {
      throw checkpointFailure(CheckpointError.DraftTampered);
    }

    await this.assertSourceFresh(source, draft.source);
    const manual = manualApproval(approval, Date.now());

    assertSummaryBudget(editedSummary, this.maxBytes);

    const body = { ...draft.body, summary: editedSummary };
    const byteCount = Buffer.byteLength(JSON.stringify(body));

    if (byteCount > this.maxBytes) {
      throw checkpointFailure(CheckpointError.SizeLimit);
    }

    const checkpoint: LocalContextCheckpoint = {
      version: 1,
      id,
      ownerId: this.options.ownerId,
      source: draft.source,
      selectedMessageIds: draft.selectedMessageIds,
      coverage: draft.coverage,
      missingMessageIds: draft.missingMessageIds,
      textTruncated: draft.textTruncated,
      byteCount,
      estimatedTokens: estimatedTokens(byteCount),
      body,
      digest: '',
      approval: manual,
      createdAt: Date.now(),
    };

    const { digest: _digest, ...unsigned } = checkpoint;

    checkpoint.digest = checkpointDigest(unsigned);

    await writePrivateFile(
      this.options.directory,
      `checkpoint-${id}.json`,
      Buffer.from(JSON.stringify(checkpoint)),
      CheckpointLimits.MaxManifestBytes,
    );

    try {
      await this.assertSourceFresh(source, draft.source);
    } catch (error) {
      await unlink(join(this.options.directory, `checkpoint-${id}.json`));
      throw error;
    }

    return approvedSummary(checkpoint);
  }

  async readCheckpoint(
    id: string,
    expectedDigest: string,
    source: CheckpointSource,
  ): Promise<LocalContextCheckpoint> {
    return readApprovedCheckpoint(this.options.directory, this.options.ownerId, id, expectedDigest, source);
  }

  async assertCheckpointFresh(checkpoint: LocalContextCheckpoint, source: CheckpointSource) {
    return this.assertSourceFresh(source, checkpoint.source);
  }

  private async assertSourceFresh(source: CheckpointSource, expected: LocalContextCheckpoint['source']) {
    assertCurrent(normalizeFence(await source.captureFence()), expected);
  }
}
