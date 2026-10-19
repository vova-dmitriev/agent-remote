import { randomUUID } from 'node:crypto';
import {
  attachmentSchema,
  ATTACHMENT_TTL_MS,
  ErrorCode,
  type AttachmentDescriptor,
  type Session,
} from '@protocol';
import { MediaFiles } from './files.js';
import {
  assertIntegrity,
  describeMedia,
  MEDIA_LIMITS,
  type LocalMediaOptions,
  type StoredMedia,
  type UploadMetadata,
} from './types.js';

export class MediaCatalog {
  readonly files: MediaFiles;

  constructor(private options: LocalMediaOptions) {
    this.files = new MediaFiles(options.directory);

    options.database.connection.exec(`CREATE TABLE IF NOT EXISTS local_media (
      owner TEXT NOT NULL, session TEXT NOT NULL, id TEXT NOT NULL, upload_id TEXT NOT NULL,
      generation TEXT NOT NULL, descriptor TEXT NOT NULL, expires_at INTEGER NOT NULL, source TEXT,
      PRIMARY KEY(owner,session,id), UNIQUE(owner,session,upload_id))`);
  }

  quota(session: string, required: number, staged = 0) {
    const rows = this.options.database.connection
      .prepare('SELECT descriptor FROM local_media WHERE owner=? AND session=?')
      .all(this.options.ownerId, session) as { descriptor: string }[];

    const total = rows.reduce(
      (sum, row) => sum + attachmentSchema.parse(JSON.parse(row.descriptor)).byteLength,
      0,
    );

    if (rows.length >= MEDIA_LIMITS.maxFiles || total + staged + required > MEDIA_LIMITS.sessionBytes) {
      throw new Error(ErrorCode.ATTACHMENT_QUOTA);
    }
  }

  get(session: string, id: string): AttachmentDescriptor | undefined {
    this.files.path(id);

    const row = this.options.database.connection
      .prepare('SELECT * FROM local_media WHERE owner=? AND session=? AND id=?')
      .get(this.options.ownerId, session, id) as StoredMedia | undefined;

    if (!row) {
      return undefined;
    }

    if (row.expires_at <= Date.now()) {
      throw new Error(ErrorCode.ATTACHMENT_EXPIRED);
    }

    return attachmentSchema.parse(JSON.parse(row.descriptor));
  }

  bytes(descriptor: AttachmentDescriptor): Buffer {
    const bytes = this.files.read(descriptor.id);

    assertIntegrity(descriptor, bytes);

    return bytes;
  }

  finish(stage: string, session: Session, metadata: UploadMetadata): AttachmentDescriptor {
    const bytes = this.files.read(stage, true);

    if (bytes.length !== metadata.byteLength) {
      throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
    }

    const incoming = describeMedia(randomUUID(), metadata, bytes);

    const known = this.upload(session.id, metadata.uploadId);

    if (known) {
      const descriptor = attachmentSchema.parse(JSON.parse(known.descriptor));

      if (
        known.generation !== session.generation ||
        descriptor.sha256 !== incoming.sha256 ||
        descriptor.name !== metadata.name ||
        descriptor.mimeType !== incoming.mimeType ||
        descriptor.byteLength !== bytes.length ||
        known.source !== (metadata.source ? JSON.stringify(metadata.source) : null)
      ) {
        throw new Error(ErrorCode.ATTACHMENT_ID_REUSED);
      }

      this.bytes(descriptor);
      this.files.remove(stage, true);

      return descriptor;
    }

    this.save(stage, session, incoming, metadata);

    return incoming;
  }

  upload(session: string, uploadId: string): StoredMedia | undefined {
    return this.options.database.connection
      .prepare('SELECT * FROM local_media WHERE owner=? AND session=? AND upload_id=?')
      .get(this.options.ownerId, session, uploadId) as StoredMedia | undefined;
  }

  import(session: Session, raw: AttachmentDescriptor, bytes: Uint8Array) {
    const parsed = attachmentSchema.safeParse(raw);

    if (!parsed.success) {
      throw new Error(ErrorCode.INVALID_ATTACHMENT);
    }

    const descriptor = parsed.data;

    this.files.path(descriptor.id);

    assertIntegrity(descriptor, bytes);

    const existing = this.get(session.id, descriptor.id);

    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(descriptor)) {
        throw new Error(ErrorCode.ATTACHMENT_ID_REUSED);
      }

      this.bytes(existing);

      return;
    }

    const stage = randomUUID();

    this.files.create(stage);

    try {
      this.files.append(stage, 0, bytes);
      this.save(stage, session, descriptor, { ...descriptor, uploadId: descriptor.id });
    } finally {
      this.files.remove(stage, true);
    }
  }

  private save(stage: string, session: Session, descriptor: AttachmentDescriptor, metadata: UploadMetadata) {
    this.quota(session.id, descriptor.byteLength);
    this.files.publish(stage, descriptor.id);

    try {
      this.options.database.connection
        .prepare('INSERT INTO local_media VALUES(?,?,?,?,?,?,?,?)')
        .run(
          this.options.ownerId,
          session.id,
          descriptor.id,
          metadata.uploadId,
          session.generation,
          JSON.stringify(descriptor),
          Date.now() + ATTACHMENT_TTL_MS,
          metadata.source ? JSON.stringify(metadata.source) : null,
        );
    } catch (error) {
      this.files.remove(descriptor.id);
      throw error;
    }
  }

  prune() {
    this.files.prune();

    const rows = this.options.database.connection
      .prepare('SELECT * FROM local_media WHERE owner=? AND expires_at<=? LIMIT ?')
      .all(this.options.ownerId, Date.now(), MEDIA_LIMITS.maxFiles) as StoredMedia[];

    for (const row of rows) {
      const descriptor = attachmentSchema.parse(JSON.parse(row.descriptor));

      this.files.remove(descriptor.id);

      this.options.database.connection
        .prepare('DELETE FROM local_media WHERE owner=? AND session=? AND id=?')
        .run(this.options.ownerId, row.session, descriptor.id);
    }
  }
}
