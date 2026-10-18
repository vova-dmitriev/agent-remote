import type { AttachmentDescriptor, Session } from '../../../../../packages/protocol/src/index.js';
import type { AttachmentService } from '../../attachments/service.js';
import { RepositoryFenceScope } from './values.js';

export interface NativeCheckpointBinding {
  ownerId: string;
  deviceId: string;
  executionId: string;
  sessionId: string;
  generation: string;
  currentSession(): Session | undefined;
}

export interface NativeCheckpointSourceOptions extends NativeCheckpointBinding {
  attachments: CheckpointAttachmentService;
  repositoryProbe?: RepositoryProbe;
}

export interface RepositoryIdentity {
  revision: string;
  workingTree: RepositoryWorkingTreeIdentity;
}

export type RepositoryWorkingTreeIdentity =
  `${typeof RepositoryFenceScope.GitVisibleMetadataV1}:${number}:${string}`;

export type RepositoryProbe = (cwd: string) => Promise<RepositoryIdentity>;

export type CheckpointAttachmentService = Pick<AttachmentService, 'prepare'>;

export interface AttachmentReferenceEntry {
  descriptor: AttachmentDescriptor;
  messageId: string;
}
