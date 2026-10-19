import { randomUUID } from 'node:crypto';
import {
  CheckpointAttachmentStatus,
  type CheckpointCoverage,
  CheckpointVisibleRole,
} from '../../domain/continuity/checkpoint.js';
import { CheckpointLimits, CheckpointError, checkpointFailure } from './values.js';
import type {
  CheckpointMessage,
  CheckpointSelection,
  CheckpointSource,
  LocalContextCheckpointBody,
  SourceFence,
} from './types.js';
import { assertCurrent, assertFence, checkpointCoverage, normalizeFence, trimUtf8 } from './values.js';
import { pageSelectedMessages } from './paging.js';

export interface CollectedContext {
  id: string;
  source: SourceFence;
  selectedMessageIds: string[];
  missingMessageIds: string[];
  textTruncated: boolean;
  byteCount: number;
  body: LocalContextCheckpointBody;
  coverage: CheckpointCoverage;
  estimatedTokens: number;
  attachmentCount: number;
}

export async function collectContext(input: {
  source: CheckpointSource;
  selection: CheckpointSelection;
  expectedOwnerId: string;
  pageSize: number;
  maxPages: number;
  maxBytes: number;
  maxMessages: number;
  persistAttachment(reference: NonNullable<CheckpointMessage['attachments']>[number]): Promise<{
    id: string;
    hash: string | null;
    status: CheckpointAttachmentStatus;
  }>;
}): Promise<CollectedContext> {
  const initial = normalizeFence(await input.source.captureFence());

  assertFence(initial, input.expectedOwnerId);
  const selected = new Set(input.selection.selectedMessageIds);
  const selectedAttachments = new Set(input.selection.selectedAttachmentIds);

  if (
    !selected.size ||
    selected.size > input.maxMessages ||
    selected.size !== input.selection.selectedMessageIds.length ||
    selectedAttachments.size !== input.selection.selectedAttachmentIds.length ||
    selectedAttachments.size > CheckpointLimits.MaxAttachments
  ) {
    throw checkpointFailure(CheckpointError.SelectionInvalid);
  }

  if (
    input.selection.constraints.length > 100 ||
    input.selection.constraints.some((value) => typeof value !== 'string')
  ) {
    throw checkpointFailure(CheckpointError.ConstraintsInvalid);
  }

  const { found, pages, hasMore } = await pageSelectedMessages(
    input.source,
    selected,
    initial,
    input.pageSize,
    input.maxPages,
  );

  let textTruncated = false;

  const missingMessageIds = input.selection.selectedMessageIds.filter((id) => !found.has(id));
  let bytes = 0;
  let missingAttachmentCount = 0;
  let attachmentCount = 0;
  const foundAttachments = new Set<string>();
  const messages = [];

  for (const id of input.selection.selectedMessageIds) {
    const message = found.get(id);

    if (!message) {
      continue;
    }

    const originalTextBytes = Buffer.byteLength(message.text);
    const text = message.text.slice(0, Math.max(0, input.maxBytes - bytes));

    bytes += Buffer.byteLength(text);
    textTruncated ||= Buffer.byteLength(text) < originalTextBytes;
    const attachments = [];

    for (const reference of message.attachments ?? []) {
      if (!selectedAttachments.has(reference.id)) {
        continue;
      }

      foundAttachments.add(reference.id);
      attachmentCount++;

      if (attachmentCount > CheckpointLimits.MaxAttachments) {
        throw checkpointFailure(CheckpointError.AttachmentLimit);
      }

      assertCurrent(normalizeFence(await input.source.captureFence()), initial);
      const attachment = await input.persistAttachment(reference);

      assertCurrent(normalizeFence(await input.source.captureFence()), initial);

      if (attachment.status === CheckpointAttachmentStatus.Missing) {
        missingAttachmentCount++;
      }

      attachments.push(attachment);
    }

    messages.push({ id: message.id, role: message.role as CheckpointVisibleRole, text, attachments });
  }

  if ([...selectedAttachments].some((id) => !foundAttachments.has(id))) {
    throw checkpointFailure(CheckpointError.SelectionInvalid);
  }

  const constraints = input.selection.constraints.map((value) => value.slice(0, 2000));
  const body: LocalContextCheckpointBody = { messages, constraints, summary: '' };
  let byteCount = Buffer.byteLength(JSON.stringify(body));

  while (byteCount > input.maxBytes) {
    const message = [...messages].reverse().find((item) => item.text.length > 0);

    if (message) {
      message.text = trimUtf8(
        message.text,
        Math.max(0, Buffer.byteLength(message.text) - (byteCount - input.maxBytes) - 1),
      );

      textTruncated = true;
    } else if (constraints.length && constraints.at(-1)!.length) {
      const tail = constraints.at(-1)!;

      constraints[constraints.length - 1] = trimUtf8(
        tail,
        Math.max(0, Buffer.byteLength(tail) - (byteCount - input.maxBytes) - 1),
      );

      textTruncated = true;
    } else {
      throw checkpointFailure(CheckpointError.MetadataExceedsBudget);
    }

    byteCount = Buffer.byteLength(JSON.stringify(body));
  }

  const coverage = checkpointCoverage({
    missingMessageIds,
    missingAttachmentCount,
    stoppedAtPageLimit: hasMore && pages >= input.maxPages,
    textTruncated,
  });

  bytes = byteCount;

  return {
    id: randomUUID(),
    source: initial,
    selectedMessageIds: [...input.selection.selectedMessageIds],
    missingMessageIds: [...new Set(missingMessageIds)],
    textTruncated,
    body,
    coverage,
    byteCount,
    estimatedTokens: Math.ceil(bytes / 4),
    attachmentCount: messages.reduce((n, message) => n + message.attachments.length, 0),
  };
}
