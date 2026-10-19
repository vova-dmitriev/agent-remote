import { randomUUID } from 'node:crypto';
import { ErrorCode, LOCAL_LIMITS, type AttachmentDescriptor, type Session } from '@protocol';
import { decodeBase64, encodeBase64 } from '@transport/native/base64.js';
import type { LocalPrincipal } from '../grants/types.js';
import { MediaCatalog } from './catalog.js';
import {
  MEDIA_LIMITS,
  samePrincipal,
  validateUpload,
  MediaAuthorization,
  TransferMode,
  type LocalMediaOptions,
  type MediaTransfer,
  type UploadMetadata,
} from './types.js';

export class MediaTransfers {
  private entries = new Map<string, MediaTransfer>();
  readonly authorization: MediaAuthorization;

  constructor(
    options: LocalMediaOptions,
    private catalog: MediaCatalog,
  ) {
    this.authorization = new MediaAuthorization(options);
  }

  reserve(session: string, bytes: number) {
    this.prune();

    const staged = [...this.entries.values()].reduce(
      (total, item) => total + (item.session.id === session ? (item.upload?.byteLength ?? 0) : 0),
      0,
    );

    if (this.entries.size >= LOCAL_LIMITS.maxTransfers) {
      throw new Error(ErrorCode.ATTACHMENT_QUOTA);
    }

    this.catalog.quota(session, bytes, staged);
  }

  begin(principal: LocalPrincipal, source: Session, upload: UploadMetadata) {
    validateUpload(upload);
    this.reserve(source.id, upload.byteLength);
    const id = randomUUID();

    this.catalog.files.create(id);

    this.entries.set(id, {
      principal: structuredClone(principal),
      session: source,
      mode: TransferMode.Upload,
      offset: 0,
      expiresAt: Date.now() + MEDIA_LIMITS.stageExpiryMs,
      upload,
    });

    return { transferId: id };
  }

  chunk(principal: LocalPrincipal, id: string, offset: number, data: string) {
    const entry = this.get(principal, id, TransferMode.Upload);
    const padding = data.endsWith('==') ? 2 : Number(data.endsWith('='));

    if ((data.length / 4) * 3 - padding > LOCAL_LIMITS.chunkBytes) {
      throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
    }

    const bytes = decodeBase64(data);

    if (!bytes.length || offset !== entry.offset || offset + bytes.length > entry.upload!.byteLength) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    this.catalog.files.append(id, offset, bytes);
    entry.offset += bytes.length;

    return { offset: entry.offset };
  }

  finish(principal: LocalPrincipal, id: string): AttachmentDescriptor {
    const entry = this.get(principal, id, TransferMode.Upload);

    if (entry.offset !== entry.upload!.byteLength) {
      throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
    }

    const descriptor = this.catalog.finish(id, entry.session, entry.upload!);

    this.entries.delete(id);

    return descriptor;
  }

  abort(principal: LocalPrincipal, id: string) {
    this.get(principal, id);
    this.remove(id);

    return null;
  }

  read(principal: LocalPrincipal, source: Session, descriptor: AttachmentDescriptor) {
    this.prune();

    if (this.entries.size >= LOCAL_LIMITS.maxTransfers) {
      throw new Error(ErrorCode.ATTACHMENT_QUOTA);
    }

    this.catalog.bytes(descriptor);
    const id = randomUUID();

    this.entries.set(id, {
      principal: structuredClone(principal),
      session: source,
      mode: TransferMode.Read,
      offset: 0,
      expiresAt: Date.now() + MEDIA_LIMITS.stageExpiryMs,
      descriptor,
    });

    return { transferId: id, descriptor };
  }

  readChunk(principal: LocalPrincipal, id: string, offset: number) {
    const entry = this.get(principal, id, TransferMode.Read);

    if (offset !== entry.offset) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const bytes = this.catalog.bytes(entry.descriptor!);
    const end = Math.min(bytes.length, offset + LOCAL_LIMITS.chunkBytes);
    const result = { data: encodeBase64(bytes.subarray(offset, end)), done: end === bytes.length };

    entry.offset = end;

    if (result.done) {
      this.entries.delete(id);
    }

    return result;
  }

  prune() {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= Date.now()) {
        this.remove(id);
      }
    }
  }

  close() {
    for (const id of this.entries.keys()) {
      this.remove(id);
    }
  }

  private get(principal: LocalPrincipal, id: string, mode?: TransferMode): MediaTransfer {
    const entry = this.entries.get(id);

    if (!entry) {
      throw new Error(ErrorCode.ATTACHMENT_UNAVAILABLE);
    }

    if (!samePrincipal(entry.principal, principal)) {
      throw new Error(ErrorCode.LOCAL_GRANT_REVOKED);
    }

    try {
      this.authorization.authorize(principal, entry.session);

      if (entry.expiresAt <= Date.now()) {
        throw new Error(ErrorCode.LOCAL_TRANSFER_EXPIRED);
      }

      if (mode && entry.mode !== mode) {
        throw new Error(ErrorCode.INVALID_FRAME);
      }
    } catch (error) {
      this.remove(id);
      throw error;
    }

    return entry;
  }

  private remove(id: string) {
    if (this.entries.get(id)?.mode === TransferMode.Upload) {
      this.catalog.files.remove(id, true);
    }

    this.entries.delete(id);
  }
}
