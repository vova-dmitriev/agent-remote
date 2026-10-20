import type { CheckpointApproval, CheckpointCoverage, ContextCheckpointSummary } from '@protocol';
import type {
  CheckpointAttachmentStatus,
  CheckpointMessageRole,
  CheckpointVisibleRole,
} from '../../domain/continuity/checkpoint.js';

export interface SourceFence {
  ownerId: string;
  deviceId: string;
  executionId: string;
  generation: string;
  historyWatermark: string;
  repositoryRevision: string | null;
  workingTree: string;
}

export interface CheckpointAttachmentReference {
  id: string;
  path: string;
}

export interface CheckpointMessage {
  id: string;
  role: CheckpointMessageRole;
  visible: boolean;
  text: string;
  attachments?: CheckpointAttachmentReference[];
}

export interface CheckpointSource {
  captureFence(): Promise<SourceFence>;
  page(request: { anchor?: string; limit: number; watermark: string }): Promise<{
    messages: CheckpointMessage[];
    nextAnchor: string | null;
    hasMore: boolean;
  }>;
  readAttachment(reference: CheckpointAttachmentReference, maxBytes: number): Promise<Uint8Array>;
}

export interface CheckpointSelection {
  selectedMessageIds: readonly string[];
  selectedAttachmentIds: readonly string[];
  constraints: readonly string[];
}

export interface CheckpointBodyAttachment {
  id: string;
  hash: string | null;
  status: CheckpointAttachmentStatus;
}

export interface CheckpointBodyMessage {
  id: string;
  role: CheckpointVisibleRole;
  text: string;
  attachments: CheckpointBodyAttachment[];
}

export interface LocalContextCheckpointBody {
  messages: CheckpointBodyMessage[];
  constraints: string[];
  summary: string;
}

export interface LocalContextCheckpoint {
  version: 1;
  id: string;
  ownerId: string;
  source: SourceFence;
  selectedMessageIds: string[];
  missingMessageIds: string[];
  textTruncated: boolean;
  byteCount: number;
  coverage: CheckpointCoverage;
  estimatedTokens: number;
  body: LocalContextCheckpointBody;
  digest: string;
  approval: CheckpointApproval;
  createdAt: number;
}

export interface ContextCheckpointDraft {
  id: string;
  digest: string;
  approved: false;
  sourceExecutionId: string;
  sourceGeneration: string;
  historyWatermark: string;
  coverage: CheckpointCoverage;
  messageCount: number;
  attachmentCount: number;
  estimatedTokens: number;
  missingMessageIds: string[];
  textTruncated: boolean;
  byteCount: number;
}

export type ApprovedContextCheckpoint = ContextCheckpointSummary;

export interface CheckpointManagerOptions {
  directory: string;
  ownerId: string;
  pageSize?: number;
  maxPages?: number;
  maxBytes?: number;
  maxAttachmentBytes?: number;
  maxMessages?: number;
}
