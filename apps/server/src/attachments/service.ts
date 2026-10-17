import {
  BindingState,
  IntegrationState,
  attachmentSchema,
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  sessionSchema,
  type AttachmentDescriptor,
  type Session,
} from '../../../../packages/protocol/src/index.js';
import { ATTACHMENT_REUSE_EXPIRY_MARGIN_MS } from './limits.js';
import { AttachmentFaultCode } from './errors.js';
import { z } from 'zod';
import { pruneAttachmentBlobs, reserveAttachmentBytes } from './cache.js';
import { Fault } from '../auth/security.js';
import { type Database } from '../db/database.js';
import { describeAttachment } from './media.js';

export interface AttachmentContext {
  ownerId: string;
  deviceId: string;
  sessionId: string;
}
export interface AttachmentUpload {
  uploadId: string;
  name: string;
  mimeType: string;
  generation: string;
  bytes: Buffer;
  source?: { messageId: string; position: string };
}

export class AttachmentService {
  constructor(private db: Database) {}

  async session(context: AttachmentContext): Promise<Session> {
    const row = (
      await this.db.pool.query<{ data: unknown }>(
        'SELECT s.data FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.device_id=$2 AND s.id=$3 AND d.revoked_at IS NULL',
        [context.ownerId, context.deviceId, context.sessionId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault('NOT_FOUND', 404);
    }

    return sessionSchema.parse(row.data);
  }

  async store(
    context: AttachmentContext,
    input: AttachmentUpload,
    deviceExport: boolean,
    onReuse?: () => void,
  ): Promise<AttachmentDescriptor> {
    z.uuid().parse(input.uploadId);

    if (input.source) {
      z.strictObject({
        messageId: z.string().min(1).max(512),
        position: z.string().min(10).max(2048).startsWith('position:'),
      }).parse(input.source);
    }

    if (input.source && !deviceExport) {
      throw new Fault(AttachmentFaultCode.Invalid);
    }

    if (!Buffer.isBuffer(input.bytes) || !input.bytes.length) {
      throw new Fault(AttachmentFaultCode.Invalid);
    }

    if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Fault(AttachmentFaultCode.TooLarge, 413);
    }

    const descriptor = describeAttachment(input.uploadId, input.name, input.mimeType, input.bytes);

    return this.db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [context.ownerId]);

      const device = await tx.query(
        'SELECT id FROM devices WHERE owner_id=$1 AND id=$2 AND revoked_at IS NULL FOR SHARE',
        [context.ownerId, context.deviceId],
      );

      if (!device.rowCount) {
        throw new Fault('NOT_FOUND', 404);
      }

      const sessionRow = (
        await tx.query<{ data: unknown }>(
          'SELECT data FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3',
          [context.ownerId, context.deviceId, context.sessionId],
        )
      ).rows[0];

      if (!sessionRow) {
        throw new Fault('NOT_FOUND', 404);
      }

      const session = sessionSchema.parse(sessionRow.data);

      if (session.generation !== input.generation) {
        throw new Fault('STALE_SESSION', 409);
      }

      if (
        !deviceExport &&
        (!session.capabilities.prompt ||
          !session.capabilities.attachments ||
          session.binding !== BindingState.Verified ||
          session.integrationState !== IntegrationState.Ready)
      ) {
        throw new Fault('CAPABILITY_UNAVAILABLE', 409);
      }

      const existing = (
        await tx.query<{
          descriptor: unknown;
          device_id: string;
          session_id: string;
          expires_at: string;
          available: boolean;
        }>(
          'SELECT descriptor,device_id,session_id,expires_at,(bytes IS NOT NULL OR EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=attachments.owner_id AND b.sha256=attachments.blob_sha256)) AS available FROM attachments WHERE owner_id=$1 AND id=$2',
          [context.ownerId, input.uploadId],
        )
      ).rows[0];

      if (existing) {
        if (
          existing.device_id !== context.deviceId ||
          existing.session_id !== context.sessionId ||
          JSON.stringify(attachmentSchema.parse(existing.descriptor)) !== JSON.stringify(descriptor)
        ) {
          throw new Fault(AttachmentFaultCode.IdReused, 409);
        }

        if (Number(existing.expires_at) <= Date.now()) {
          throw new Fault(AttachmentFaultCode.Expired, 410);
        }

        if (existing.available) {
          if (input.source) {
            await tx.query(
              'UPDATE attachments SET source_message_id=$3,source_position=$4 WHERE owner_id=$1 AND id=$2 AND device_export',
              [context.ownerId, input.uploadId, input.source.messageId, input.source.position],
            );
          }

          onReuse?.();

          return descriptor;
        }

        if (deviceExport) {
          await reserveAttachmentBytes(tx, context.ownerId, input.bytes.length);

          await tx.query(
            'INSERT INTO attachment_blobs(owner_id,sha256,bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [context.ownerId, descriptor.sha256, input.bytes],
          );

          await tx.query(
            'UPDATE attachments SET source_message_id=coalesce($3,source_message_id),source_position=coalesce($4,source_position) WHERE owner_id=$1 AND id=$2 AND device_export',
            [
              context.ownerId,
              input.uploadId,
              input.source?.messageId ?? null,
              input.source?.position ?? null,
            ],
          );

          return descriptor;
        }

        await tx.query('DELETE FROM attachments WHERE owner_id=$1 AND id=$2', [
          context.ownerId,
          input.uploadId,
        ]);
      }

      await tx.query('DELETE FROM attachments WHERE owner_id=$1 AND expires_at<=$2', [
        context.ownerId,
        Date.now(),
      ]);

      await pruneAttachmentBlobs(tx, context.ownerId);

      if (deviceExport) {
        const known = (
          await tx.query<{ descriptor: unknown; inline: boolean }>(
            "SELECT descriptor,bytes IS NOT NULL AS inline FROM attachments WHERE owner_id=$1 AND device_id=$2 AND session_id=$3 AND descriptor->>'sha256'=$4 AND descriptor->>'name'=$5 AND descriptor->>'mimeType'=$6 AND expires_at>$7 ORDER BY created_at DESC LIMIT 1",
            [
              context.ownerId,
              context.deviceId,
              context.sessionId,
              descriptor.sha256,
              descriptor.name,
              descriptor.mimeType,
              Date.now() + ATTACHMENT_REUSE_EXPIRY_MARGIN_MS,
            ],
          )
        ).rows[0];

        if (known) {
          const result = attachmentSchema.parse(known.descriptor);

          const present =
            known.inline ||
            (
              await tx.query('SELECT 1 FROM attachment_blobs WHERE owner_id=$1 AND sha256=$2', [
                context.ownerId,
                result.sha256,
              ])
            ).rowCount;

          if (!present) {
            await reserveAttachmentBytes(tx, context.ownerId, input.bytes.length);

            await tx.query(
              'INSERT INTO attachment_blobs(owner_id,sha256,bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
              [context.ownerId, result.sha256, input.bytes],
            );
          }

          if (input.source) {
            await tx.query(
              'UPDATE attachments SET source_message_id=$3,source_position=$4 WHERE owner_id=$1 AND id=$2 AND device_export',
              [context.ownerId, result.id, input.source.messageId, input.source.position],
            );
          }

          if (present) {
            onReuse?.();
          }

          return result;
        }
      }

      const blob = deviceExport
        ? (
            await tx.query('SELECT 1 FROM attachment_blobs WHERE owner_id=$1 AND sha256=$2', [
              context.ownerId,
              descriptor.sha256,
            ])
          ).rowCount
        : 0;

      await reserveAttachmentBytes(tx, context.ownerId, blob ? 0 : input.bytes.length);

      if (deviceExport) {
        await tx.query(
          'INSERT INTO attachment_blobs(owner_id,sha256,bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [context.ownerId, descriptor.sha256, input.bytes],
        );
      }

      const now = Date.now();

      await tx.query(
        'INSERT INTO attachments(owner_id,device_id,session_id,id,descriptor,bytes,created_at,expires_at,blob_sha256,device_export,source_message_id,source_position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          context.ownerId,
          context.deviceId,
          context.sessionId,
          input.uploadId,
          JSON.stringify(descriptor),
          deviceExport ? null : input.bytes,
          now,
          now + ATTACHMENT_TTL_MS,
          deviceExport ? descriptor.sha256 : null,
          deviceExport,
          input.source?.messageId ?? null,
          input.source?.position ?? null,
        ],
      );

      return descriptor;
    });
  }

  async read(context: AttachmentContext, id: string) {
    const row = (
      await this.db.pool.query<{ descriptor: unknown; bytes: Buffer; expires_at: string }>(
        'SELECT a.descriptor,coalesce(a.bytes,b.bytes) AS bytes,a.expires_at FROM attachments a LEFT JOIN attachment_blobs b ON b.owner_id=a.owner_id AND b.sha256=a.blob_sha256 JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND d.revoked_at IS NULL',
        [context.ownerId, context.deviceId, context.sessionId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault('NOT_FOUND', 404);
    }

    if (Number(row.expires_at) <= Date.now()) {
      throw new Fault(AttachmentFaultCode.Expired, 410);
    }

    if (!row.bytes) {
      throw new Fault(AttachmentFaultCode.RebuildRequired, 503);
    }

    return { descriptor: attachmentSchema.parse(row.descriptor), bytes: row.bytes };
  }

  async available(context: AttachmentContext, id: string) {
    const result = await this.db.pool.query(
      'SELECT 1 FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND a.expires_at>$5 AND d.revoked_at IS NULL AND (a.bytes IS NOT NULL OR EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=a.owner_id AND b.sha256=a.blob_sha256))',
      [context.ownerId, context.deviceId, context.sessionId, id, Date.now()],
    );

    return Boolean(result.rowCount);
  }
  async source(context: AttachmentContext, id: string) {
    const row = (
      await this.db.pool.query<{ source_message_id: string; source_position: string }>(
        'SELECT a.source_message_id,a.source_position FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=$4 AND a.expires_at>$5 AND d.revoked_at IS NULL AND a.device_export AND a.source_message_id IS NOT NULL AND a.source_position IS NOT NULL',
        [context.ownerId, context.deviceId, context.sessionId, id, Date.now()],
      )
    ).rows[0];

    if (!row) {
      throw new Fault('NOT_FOUND', 404);
    }

    return { messageId: row.source_message_id, position: row.source_position };
  }

  async validate(context: AttachmentContext, descriptors: AttachmentDescriptor[]) {
    const rows = (
      await this.db.pool.query<{ id: string; descriptor: unknown; expires_at: string }>(
        'SELECT a.id,a.descriptor,a.expires_at FROM attachments a JOIN devices d ON d.owner_id=a.owner_id AND d.id=a.device_id WHERE a.owner_id=$1 AND a.device_id=$2 AND a.session_id=$3 AND a.id=ANY($4::text[]) AND d.revoked_at IS NULL',
        [context.ownerId, context.deviceId, context.sessionId, descriptors.map((item) => item.id)],
      )
    ).rows;

    const stored = new Map(rows.map((row) => [row.id, row]));

    for (const descriptor of descriptors) {
      const row = stored.get(descriptor.id);

      if (!row) {
        throw new Fault('NOT_FOUND', 404);
      }

      if (Number(row.expires_at) <= Date.now()) {
        throw new Fault(AttachmentFaultCode.Expired, 410);
      }

      if (JSON.stringify(attachmentSchema.parse(row.descriptor)) !== JSON.stringify(descriptor)) {
        throw new Fault(AttachmentFaultCode.Mismatch, 409);
      }
    }
  }

  async prune() {
    return this.db.transaction(async (tx) => {
      const result = await tx.query('DELETE FROM attachments WHERE expires_at<=$1', [Date.now()]);

      await tx.query(
        'DELETE FROM attachment_blobs b WHERE NOT EXISTS(SELECT 1 FROM attachments a WHERE a.owner_id=b.owner_id AND a.blob_sha256=b.sha256)',
      );

      return result;
    });
  }
}
