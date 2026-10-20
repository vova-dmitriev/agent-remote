import type { PoolClient } from 'pg';
import type { Database } from '../../db/database.js';

export interface OwnedSession {
  ownerId: string;
  deviceId: string;
  sessionId: string;
}

export interface StoredAttachmentRow {
  descriptor: unknown;
  device_id: string;
  session_id: string;
  expires_at: string;
  available: boolean;
}

export interface NewAttachment {
  id: string;
  descriptor: string;
  bytes: Buffer | null;
  createdAt: number;
  expiresAt: number;
  blobSha256: string | null;
  deviceExport: boolean;
  sourceMessageId: string | null;
  sourcePosition: string | null;
}

/** Uploaded attachments and their content-addressed blobs, per owner. */
export class AttachmentRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** The data of an owned session on a live device. */
  async session(scope: OwnedSession): Promise<unknown> {
    return (
      await this.db.pool.query<{ data: unknown }>(
        'SELECT s.data FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.device_id=$2 AND s.id=$3 AND d.revoked_at IS NULL',
        [scope.ownerId, scope.deviceId, scope.sessionId],
      )
    ).rows[0]?.data;
  }

  /** The device of an owned session on a live device. */
  async sessionDevice(ownerId: string, sessionId: string): Promise<string | undefined> {
    return (
      await this.db.pool.query<{ device_id: string }>(
        'SELECT s.device_id FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [ownerId, sessionId],
      )
    ).rows[0]?.device_id;
  }

  /** Serializes an owner's uploads. */
  async lockOwner(tx: PoolClient, ownerId: string) {
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
  }

  /** Holds an owned, unrevoked device against revocation; returns whether it exists. */
  async shareDevice(tx: PoolClient, ownerId: string, deviceId: string): Promise<boolean> {
    return Boolean(
      (
        await tx.query(
          'SELECT id FROM devices WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL FOR SHARE',
          [ownerId, deviceId],
        )
      ).rowCount,
    );
  }

  async sessionData(tx: PoolClient, scope: OwnedSession): Promise<unknown> {
    return (
      await tx.query<{ data: unknown }>(
        'SELECT data FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3',
        [scope.ownerId, scope.deviceId, scope.sessionId],
      )
    ).rows[0]?.data;
  }

  async stored(tx: PoolClient, ownerId: string, id: string): Promise<StoredAttachmentRow | undefined> {
    return (
      await tx.query<StoredAttachmentRow>(
        'SELECT descriptor,device_id,session_id,expires_at,(bytes IS NOT NULL OR EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=attachments.owner_id AND b.sha256=attachments.blob_sha256)) AS available FROM attachments WHERE owner_id=$1 AND id=$2',
        [ownerId, id],
      )
    ).rows[0];
  }

  /** Points a device export at the message it came from. */
  async setSource(tx: PoolClient, ownerId: string, id: string, messageId: string, position: string) {
    await tx.query(
      'UPDATE attachments SET source_message_id=$3,source_position=$4 WHERE owner_id=$1 AND id=$2 AND device_export',
      [ownerId, id, messageId, position],
    );
  }

  /** Fills a device export's missing source from the given one. */
  async keepSource(
    tx: PoolClient,
    ownerId: string,
    id: string,
    messageId: string | null,
    position: string | null,
  ) {
    await tx.query(
      'UPDATE attachments SET source_message_id=coalesce($3,source_message_id),source_position=coalesce($4,source_position) WHERE owner_id=$1 AND id=$2 AND device_export',
      [ownerId, id, messageId, position],
    );
  }

  async insertBlob(tx: PoolClient, ownerId: string, sha256: string, bytes: Buffer) {
    await tx.query(
      'INSERT INTO attachment_blobs(owner_id,sha256,bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [ownerId, sha256, bytes],
    );
  }

  async hasBlob(tx: PoolClient, ownerId: string, sha256: string): Promise<boolean> {
    return Boolean(
      (await tx.query('SELECT 1 FROM attachment_blobs WHERE owner_id=$1 AND sha256=$2', [ownerId, sha256]))
        .rowCount,
    );
  }

  async delete(tx: PoolClient, ownerId: string, id: string) {
    await tx.query('DELETE FROM attachments WHERE owner_id=$1 AND id=$2', [ownerId, id]);
  }

  async deleteExpired(tx: PoolClient, ownerId: string, now: number) {
    await tx.query('DELETE FROM attachments WHERE owner_id=$1 AND expires_at<=$2', [ownerId, now]);
  }

  /** The newest unexpired device export of the same file in a session. */
  async knownExport(
    tx: PoolClient,
    scope: OwnedSession,
    file: { sha256: string; name: string; mimeType: string },
    expiresAfter: number,
  ) {
    return (
      await tx.query<{ descriptor: unknown; inline: boolean }>(
        "SELECT descriptor,bytes IS NOT NULL AS inline FROM attachments WHERE owner_id=$1 AND device_id=$2 AND session_id=$3 AND descriptor->>'sha256'=$4 AND descriptor->>'name'=$5 AND descriptor->>'mimeType'=$6 AND expires_at>$7 ORDER BY created_at DESC LIMIT 1",
        [scope.ownerId, scope.deviceId, scope.sessionId, file.sha256, file.name, file.mimeType, expiresAfter],
      )
    ).rows[0];
  }

  async insert(tx: PoolClient, scope: OwnedSession, attachment: NewAttachment) {
    await tx.query(
      'INSERT INTO attachments(owner_id,device_id,session_id,id,descriptor,bytes,created_at,expires_at,blob_sha256,device_export,source_message_id,source_position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        scope.ownerId,
        scope.deviceId,
        scope.sessionId,
        attachment.id,
        attachment.descriptor,
        attachment.bytes,
        attachment.createdAt,
        attachment.expiresAt,
        attachment.blobSha256,
        attachment.deviceExport,
        attachment.sourceMessageId,
        attachment.sourcePosition,
      ],
    );
  }

  /** An owned attachment's descriptor, bytes (inline or from its blob) and expiry, on a live device. */
  async read(scope: OwnedSession, id: string) {
    return (
      await this.db.pool.query<{ descriptor: unknown; bytes: Buffer; expires_at: string }>(
        'SELECT a.descriptor,coalesce(a.bytes,b.bytes) AS bytes,a.expires_at FROM attachments a LEFT JOIN attachment_blobs b ON b.owner_id=a.owner_id AND b.sha256=a.blob_sha256 JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND d.revoked_at IS NULL',
        [scope.ownerId, scope.deviceId, scope.sessionId, id],
      )
    ).rows[0];
  }

  async available(scope: OwnedSession, id: string, now: number): Promise<boolean> {
    const result = await this.db.pool.query(
      'SELECT 1 FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND a.expires_at>$5 AND d.revoked_at IS NULL AND (a.bytes IS NOT NULL OR EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=a.owner_id AND b.sha256=a.blob_sha256))',
      [scope.ownerId, scope.deviceId, scope.sessionId, id, now],
    );

    return Boolean(result.rowCount);
  }

  async source(scope: OwnedSession, id: string, now: number) {
    return (
      await this.db.pool.query<{ source_message_id: string; source_position: string }>(
        'SELECT a.source_message_id,a.source_position FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND a.expires_at>$5 AND d.revoked_at IS NULL AND a.device_export AND a.source_message_id IS NOT NULL AND a.source_position IS NOT NULL',
        [scope.ownerId, scope.deviceId, scope.sessionId, id, now],
      )
    ).rows[0];
  }

  async descriptors(scope: OwnedSession, ids: readonly string[]) {
    return (
      await this.db.pool.query<{ id: string; descriptor: unknown; expires_at: string }>(
        'SELECT a.id,a.descriptor,a.expires_at FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=ANY($4::text[]) AND d.revoked_at IS NULL',
        [scope.ownerId, scope.deviceId, scope.sessionId, ids],
      )
    ).rows;
  }

  /** Drops every owner's expired attachments, then blobs no attachment references. */
  async prune(now: number) {
    return this.db.transaction(async (tx) => {
      const result = await tx.query('DELETE FROM attachments WHERE expires_at<=$1', [now]);

      await tx.query(
        'DELETE FROM attachment_blobs b WHERE NOT EXISTS(SELECT 1 FROM attachments a WHERE a.owner_id=b.owner_id AND a.blob_sha256=b.sha256)',
      );

      return result;
    });
  }

  async pruneBlobs(tx: PoolClient, ownerId: string) {
    await tx.query(
      'DELETE FROM attachment_blobs b WHERE b.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.owner_id=b.owner_id AND a.blob_sha256=b.sha256)',
      [ownerId],
    );
  }

  /** Bytes an owner stores inline and in blobs. */
  async usage(tx: PoolClient, ownerId: string): Promise<number> {
    const size = (
      await tx.query<{ total: string }>(
        `SELECT ((SELECT coalesce(sum(octet_length(bytes)),0) FROM attachments WHERE owner_id=$1)+(SELECT coalesce(sum(octet_length(bytes)),0) FROM attachment_blobs WHERE owner_id=$1))::text AS total`,
        [ownerId],
      )
    ).rows[0];

    return Number(size?.total ?? 0);
  }

  /** Blobs only device exports reference, oldest first: the ones quota may evict. */
  async evictable(tx: PoolClient, ownerId: string) {
    return (
      await tx.query<{ sha256: string; size: number }>(
        `SELECT b.sha256,max(octet_length(b.bytes))::int AS size FROM attachment_blobs b JOIN attachments a ON a.owner_id=b.owner_id AND a.blob_sha256=b.sha256 WHERE b.owner_id=$1 GROUP BY b.sha256 HAVING bool_and(a.device_export) ORDER BY min(a.created_at)`,
        [ownerId],
      )
    ).rows;
  }

  /** Drops evicted blobs and the sourceless device exports that reference them. */
  async evict(tx: PoolClient, ownerId: string, sha256s: readonly string[]) {
    await tx.query(
      'DELETE FROM attachments WHERE owner_id=$1 AND device_export AND source_position IS NULL AND blob_sha256=ANY($2::text[])',
      [ownerId, sha256s],
    );

    await tx.query('DELETE FROM attachment_blobs WHERE owner_id=$1 AND sha256=ANY($2::text[])', [
      ownerId,
      sha256s,
    ]);
  }
}
