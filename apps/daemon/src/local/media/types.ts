import { createHash } from 'node:crypto';
import {
  attachmentSchema,
  AttachmentKind,
  MAX_ATTACHMENT_BYTES,
  ErrorCode,
  type AttachmentDescriptor,
  type Session,
} from '@protocol';
import { nativeImageMime } from '../../attachments/content/image-content.js';
import { attachmentSourceCurrent } from '../../attachments/content/source-current.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalDatabase } from '../state/database.js';

export const MEDIA_LIMITS = {
  sessionBytes: 128 * 1024 * 1024,
  maxFiles: 500,
  stageExpiryMs: 5 * 60_000,
  discoveryBatch: 500,
  maintenanceMs: 60_000,
} as const;
export const TransferMode = { Upload: 'upload', Read: 'read' } as const;
export type TransferMode = (typeof TransferMode)[keyof typeof TransferMode];

export interface LocalMediaOptions {
  directory: string;
  database: LocalDatabase;
  ownerId: string;
  session: (id: string) => Session | undefined;
  current: (principal: LocalPrincipal) => boolean;
}

export interface UploadMetadata {
  uploadId: string;
  name: string;
  mimeType: string;
  byteLength: number;
  source?: { messageId: string; position: string };
}

export interface StoredMedia {
  owner: string;
  session: string;
  upload_id: string;
  generation: string;
  descriptor: string;
  expires_at: number;
  source: string | null;
}

export interface MediaTransfer {
  principal: LocalPrincipal;
  session: Session;
  mode: TransferMode;
  offset: number;
  expiresAt: number;
  upload?: UploadMetadata;
  descriptor?: AttachmentDescriptor;
}

export class MediaAuthorization {
  constructor(private options: LocalMediaOptions) {}

  authorize(principal: LocalPrincipal, source: Session) {
    if (principal.ownerId !== this.options.ownerId || !this.options.current(principal)) {
      throw new Error(ErrorCode.LOCAL_GRANT_REVOKED);
    }

    if (
      principal.deviceId !== source.target.deviceId ||
      !attachmentSourceCurrent(this.options.session(source.id), source)
    ) {
      throw new Error(ErrorCode.STALE_SESSION);
    }
  }

  session(principal: LocalPrincipal, id: string, generation?: string): Session {
    const source = this.options.session(id);

    if (!source || (generation && source.generation !== generation)) {
      throw new Error(ErrorCode.STALE_SESSION);
    }

    this.authorize(principal, source);

    return structuredClone(source);
  }
}

export const MEDIA_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export function validateUpload(metadata: UploadMetadata) {
  if (
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength < 1 ||
    metadata.byteLength > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error(ErrorCode.ATTACHMENT_TOO_LARGE);
  }

  if (!MEDIA_ID.test(metadata.uploadId) || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u.test(metadata.mimeType)) {
    throw new Error(ErrorCode.INVALID_ATTACHMENT);
  }

  const valid = attachmentSchema.safeParse({
    id: metadata.uploadId,
    name: metadata.name,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    sha256: '0'.repeat(64),
    kind: AttachmentKind.File,
  });

  if (!valid.success) {
    throw new Error(ErrorCode.INVALID_ATTACHMENT);
  }
}

export function samePrincipal(left: LocalPrincipal, right: LocalPrincipal): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.clientId === right.clientId &&
    left.lease === right.lease &&
    left.deviceId === right.deviceId &&
    left.origin === right.origin
  );
}

export function assertIntegrity(descriptor: AttachmentDescriptor, bytes: Uint8Array) {
  if (
    bytes.length !== descriptor.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256
  ) {
    throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
  }
}

export function describeMedia(id: string, metadata: UploadMetadata, bytes: Buffer): AttachmentDescriptor {
  const image = nativeImageMime(bytes);

  return attachmentSchema.parse({
    id,
    name: metadata.name,
    mimeType: image ?? metadata.mimeType,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    kind: image ? AttachmentKind.Image : AttachmentKind.File,
  });
}
