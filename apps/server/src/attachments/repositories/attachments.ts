import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lte, min, or, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { attachmentBlobs, attachments, devices, sessions, users } from '../../db/schema/index.js';

export interface OwnedSession {
  ownerId: string;
  deviceId: string;
  sessionId: string;
}

export interface StoredAttachmentRow {
  descriptor: unknown;
  device_id: string;
  session_id: string;
  expires_at: number;
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

/** The attachment's own bytes or a blob of the same owner it references. */
const hasBytes = or(
  isNotNull(attachments.bytes),
  exists(
    sql`(SELECT 1 FROM ${attachmentBlobs} WHERE ${attachmentBlobs.ownerId}=${attachments.ownerId} AND ${attachmentBlobs.sha256}=${attachments.blobSha256})`,
  ),
)!;

/** The attachment's device belongs to its owner and is not revoked. */
const liveDevice = and(eq(devices.ownerId, attachments.ownerId), eq(devices.id, attachments.deviceId))!;

const inSession = (scope: OwnedSession) =>
  and(
    eq(attachments.ownerId, scope.ownerId),
    eq(attachments.deviceId, scope.deviceId),
    eq(attachments.sessionId, scope.sessionId),
  )!;

/** Blobs the owner keeps that no attachment references any more. */
const unreferencedBlob = sql`NOT EXISTS (SELECT 1 FROM ${attachments} WHERE ${attachments.ownerId}=${attachmentBlobs.ownerId} AND ${attachments.blobSha256}=${attachmentBlobs.sha256})`;

/** Uploaded attachments and their content-addressed blobs, per owner. */
export class AttachmentRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** The data of an owned session on a live device. */
  async session(scope: OwnedSession): Promise<unknown> {
    const [row] = await this.db.orm
      .select({ data: sessions.data })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.ownerId, sessions.ownerId)))
      .where(
        and(
          eq(sessions.ownerId, scope.ownerId),
          eq(sessions.deviceId, scope.deviceId),
          eq(sessions.id, scope.sessionId),
          isNull(devices.revokedAt),
        ),
      );

    return row?.data;
  }

  /** The device of an owned session on a live device. */
  async sessionDevice(ownerId: string, sessionId: string): Promise<string | undefined> {
    const [row] = await this.db.orm
      .select({ deviceId: sessions.deviceId })
      .from(sessions)
      .innerJoin(devices, and(eq(devices.id, sessions.deviceId), eq(devices.ownerId, sessions.ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.id, sessionId), isNull(devices.revokedAt)));

    return row?.deviceId;
  }

  /** Serializes an owner's uploads. */
  async lockOwner(tx: PoolClient, ownerId: string) {
    await ormOn(tx).select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for('update');
  }

  /** Holds an owned, unrevoked device against revocation; returns whether it exists. */
  async shareDevice(tx: PoolClient, ownerId: string, deviceId: string): Promise<boolean> {
    const rows = await ormOn(tx)
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, deviceId), isNull(devices.revokedAt)))
      .for('share');

    return rows.length > 0;
  }

  async sessionData(tx: PoolClient, scope: OwnedSession): Promise<unknown> {
    const [row] = await ormOn(tx)
      .select({ data: sessions.data })
      .from(sessions)
      .where(
        and(
          eq(sessions.ownerId, scope.ownerId),
          eq(sessions.deviceId, scope.deviceId),
          eq(sessions.id, scope.sessionId),
        ),
      );

    return row?.data;
  }

  async stored(tx: PoolClient, ownerId: string, id: string): Promise<StoredAttachmentRow | undefined> {
    const [row] = await ormOn(tx)
      .select({
        descriptor: attachments.descriptor,
        device_id: attachments.deviceId,
        session_id: attachments.sessionId,
        expires_at: attachments.expiresAt,
        available: sql<boolean>`${hasBytes}`,
      })
      .from(attachments)
      .where(and(eq(attachments.ownerId, ownerId), eq(attachments.id, id)));

    return row;
  }

  /** Points a device export at the message it came from. */
  async setSource(tx: PoolClient, ownerId: string, id: string, messageId: string, position: string) {
    await ormOn(tx)
      .update(attachments)
      .set({ sourceMessageId: messageId, sourcePosition: position })
      .where(
        and(eq(attachments.ownerId, ownerId), eq(attachments.id, id), eq(attachments.deviceExport, true)),
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
    await ormOn(tx)
      .update(attachments)
      .set({
        sourceMessageId: sql`coalesce(${messageId}, ${attachments.sourceMessageId})`,
        sourcePosition: sql`coalesce(${position}, ${attachments.sourcePosition})`,
      })
      .where(
        and(eq(attachments.ownerId, ownerId), eq(attachments.id, id), eq(attachments.deviceExport, true)),
      );
  }

  async insertBlob(tx: PoolClient, ownerId: string, sha256: string, bytes: Buffer) {
    await ormOn(tx).insert(attachmentBlobs).values({ ownerId, sha256, bytes }).onConflictDoNothing();
  }

  async hasBlob(tx: PoolClient, ownerId: string, sha256: string): Promise<boolean> {
    const rows = await ormOn(tx)
      .select({ sha256: attachmentBlobs.sha256 })
      .from(attachmentBlobs)
      .where(and(eq(attachmentBlobs.ownerId, ownerId), eq(attachmentBlobs.sha256, sha256)));

    return rows.length > 0;
  }

  async delete(tx: PoolClient, ownerId: string, id: string) {
    await ormOn(tx)
      .delete(attachments)
      .where(and(eq(attachments.ownerId, ownerId), eq(attachments.id, id)));
  }

  async deleteExpired(tx: PoolClient, ownerId: string, now: number) {
    await ormOn(tx)
      .delete(attachments)
      .where(and(eq(attachments.ownerId, ownerId), lte(attachments.expiresAt, now)));
  }

  /** The newest unexpired device export of the same file in a session. */
  async knownExport(
    tx: PoolClient,
    scope: OwnedSession,
    file: { sha256: string; name: string; mimeType: string },
    expiresAfter: number,
  ) {
    const [row] = await ormOn(tx)
      .select({ descriptor: attachments.descriptor, inline: sql<boolean>`${attachments.bytes} IS NOT NULL` })
      .from(attachments)
      .where(
        and(
          inSession(scope),
          sql`${attachments.descriptor}->>'sha256'=${file.sha256}`,
          sql`${attachments.descriptor}->>'name'=${file.name}`,
          sql`${attachments.descriptor}->>'mimeType'=${file.mimeType}`,
          gt(attachments.expiresAt, expiresAfter),
        ),
      )
      .orderBy(desc(attachments.createdAt))
      .limit(1);

    return row;
  }

  async insert(tx: PoolClient, scope: OwnedSession, attachment: NewAttachment) {
    await ormOn(tx)
      .insert(attachments)
      .values({
        ownerId: scope.ownerId,
        deviceId: scope.deviceId,
        sessionId: scope.sessionId,
        id: attachment.id,
        descriptor: sql`${attachment.descriptor}::jsonb`,
        bytes: attachment.bytes,
        createdAt: attachment.createdAt,
        expiresAt: attachment.expiresAt,
        blobSha256: attachment.blobSha256,
        deviceExport: attachment.deviceExport,
        sourceMessageId: attachment.sourceMessageId,
        sourcePosition: attachment.sourcePosition,
      });
  }

  /** An owned attachment's descriptor, bytes (inline or from its blob) and expiry, on a live device. */
  async read(scope: OwnedSession, id: string) {
    const [row] = await this.db.orm
      .select({
        descriptor: attachments.descriptor,
        bytes: sql<Buffer>`coalesce(${attachments.bytes}, ${attachmentBlobs.bytes})`,
        expires_at: attachments.expiresAt,
      })
      .from(attachments)
      .leftJoin(
        attachmentBlobs,
        and(
          eq(attachmentBlobs.ownerId, attachments.ownerId),
          eq(attachmentBlobs.sha256, attachments.blobSha256),
        ),
      )
      .innerJoin(devices, liveDevice)
      .where(and(inSession(scope), eq(attachments.id, id), isNull(devices.revokedAt)));

    return row;
  }

  async available(scope: OwnedSession, id: string, now: number): Promise<boolean> {
    const rows = await this.db.orm
      .select({ id: attachments.id })
      .from(attachments)
      .innerJoin(devices, liveDevice)
      .where(
        and(
          inSession(scope),
          eq(attachments.id, id),
          gt(attachments.expiresAt, now),
          isNull(devices.revokedAt),
          hasBytes,
        ),
      );

    return rows.length > 0;
  }

  async source(scope: OwnedSession, id: string, now: number) {
    const [row] = await this.db.orm
      .select({ source_message_id: attachments.sourceMessageId, source_position: attachments.sourcePosition })
      .from(attachments)
      .innerJoin(devices, liveDevice)
      .where(
        and(
          inSession(scope),
          eq(attachments.id, id),
          gt(attachments.expiresAt, now),
          isNull(devices.revokedAt),
          eq(attachments.deviceExport, true),
          isNotNull(attachments.sourceMessageId),
          isNotNull(attachments.sourcePosition),
        ),
      );

    return row as { source_message_id: string; source_position: string } | undefined;
  }

  async descriptors(scope: OwnedSession, ids: readonly string[]) {
    if (!ids.length) {
      return [];
    }

    return this.db.orm
      .select({ id: attachments.id, descriptor: attachments.descriptor, expires_at: attachments.expiresAt })
      .from(attachments)
      .innerJoin(devices, liveDevice)
      .where(and(inSession(scope), inArray(attachments.id, [...ids]), isNull(devices.revokedAt)));
  }

  /** Drops every owner's expired attachments, then blobs no attachment references. */
  async prune(now: number) {
    return this.db.transaction(async (tx) => {
      const orm = ormOn(tx);
      const result = await orm.delete(attachments).where(lte(attachments.expiresAt, now));

      await orm.delete(attachmentBlobs).where(unreferencedBlob);

      return result;
    });
  }

  async pruneBlobs(tx: PoolClient, ownerId: string) {
    await ormOn(tx)
      .delete(attachmentBlobs)
      .where(and(eq(attachmentBlobs.ownerId, ownerId), unreferencedBlob));
  }

  /** Bytes an owner stores inline and in blobs. */
  async usage(tx: PoolClient, ownerId: string): Promise<number> {
    const [row] = await ormOn(tx)
      .select({
        total: sql<string>`((SELECT coalesce(sum(octet_length(${attachments.bytes})),0) FROM ${attachments} WHERE ${attachments.ownerId}=${ownerId})+(SELECT coalesce(sum(octet_length(${attachmentBlobs.bytes})),0) FROM ${attachmentBlobs} WHERE ${attachmentBlobs.ownerId}=${ownerId}))::text`,
      })
      .from(sql`(SELECT 1) AS one`);

    return Number(row?.total ?? 0);
  }

  /** Blobs only device exports reference, oldest first: the ones quota may evict. */
  async evictable(tx: PoolClient, ownerId: string) {
    return ormOn(tx)
      .select({
        sha256: attachmentBlobs.sha256,
        size: sql<number>`max(octet_length(${attachmentBlobs.bytes}))::int`,
      })
      .from(attachmentBlobs)
      .innerJoin(
        attachments,
        and(
          eq(attachments.ownerId, attachmentBlobs.ownerId),
          eq(attachments.blobSha256, attachmentBlobs.sha256),
        ),
      )
      .where(eq(attachmentBlobs.ownerId, ownerId))
      .groupBy(attachmentBlobs.sha256)
      .having(sql`bool_and(${attachments.deviceExport})`)
      .orderBy(asc(min(attachments.createdAt)));
  }

  /** Drops evicted blobs and the sourceless device exports that reference them. */
  async evict(tx: PoolClient, ownerId: string, sha256s: readonly string[]) {
    if (!sha256s.length) {
      return;
    }

    const orm = ormOn(tx);

    await orm
      .delete(attachments)
      .where(
        and(
          eq(attachments.ownerId, ownerId),
          eq(attachments.deviceExport, true),
          isNull(attachments.sourcePosition),
          inArray(attachments.blobSha256, [...sha256s]),
        ),
      );

    await orm
      .delete(attachmentBlobs)
      .where(and(eq(attachmentBlobs.ownerId, ownerId), inArray(attachmentBlobs.sha256, [...sha256s])));
  }
}
