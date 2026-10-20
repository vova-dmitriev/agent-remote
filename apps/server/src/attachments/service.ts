import {
  ErrorCode,
  BindingState,
  IntegrationState,
  attachmentSchema,
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  sessionSchema,
  type AttachmentDescriptor,
  type Session,
} from '@protocol';
import { ATTACHMENT_REUSE_EXPIRY_MARGIN_MS } from './limits.js';
import { AttachmentFaultCode } from './errors.js';
import { z } from 'zod';
import { reserveAttachmentBytes } from './cache.js';
import { Fault } from '../http/errors/fault.js';
import { describeAttachment } from './media.js';
import { type AttachmentRepository } from './repositories/attachments.js';

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
  constructor(private repository: AttachmentRepository) {}

  async session(context: AttachmentContext): Promise<Session> {
    const data = await this.repository.session(context);

    if (!data) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return sessionSchema.parse(data);
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
      throw new Fault(AttachmentFaultCode.TooLarge);
    }

    const descriptor = describeAttachment(input.uploadId, input.name, input.mimeType, input.bytes);

    const { repository } = this;

    return repository.transaction(async (tx) => {
      await repository.lockOwner(tx, context.ownerId);

      if (!(await repository.shareDevice(tx, context.ownerId, context.deviceId))) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      const sessionData = await repository.sessionData(tx, context);

      if (!sessionData) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      const session = sessionSchema.parse(sessionData);

      if (session.generation !== input.generation) {
        throw new Fault(ErrorCode.STALE_SESSION);
      }

      if (
        !deviceExport &&
        (!session.capabilities.prompt ||
          !session.capabilities.attachments ||
          session.binding !== BindingState.Verified ||
          session.integrationState !== IntegrationState.Ready)
      ) {
        throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      const existing = await repository.stored(tx, context.ownerId, input.uploadId);

      if (existing) {
        if (
          existing.device_id !== context.deviceId ||
          existing.session_id !== context.sessionId ||
          JSON.stringify(attachmentSchema.parse(existing.descriptor)) !== JSON.stringify(descriptor)
        ) {
          throw new Fault(AttachmentFaultCode.IdReused);
        }

        if (Number(existing.expires_at) <= Date.now()) {
          throw new Fault(AttachmentFaultCode.Expired);
        }

        if (existing.available) {
          if (input.source) {
            await repository.setSource(
              tx,
              context.ownerId,
              input.uploadId,
              input.source.messageId,
              input.source.position,
            );
          }

          onReuse?.();

          return descriptor;
        }

        if (deviceExport) {
          await reserveAttachmentBytes(repository, tx, context.ownerId, input.bytes.length);
          await repository.insertBlob(tx, context.ownerId, descriptor.sha256, input.bytes);

          await repository.keepSource(
            tx,
            context.ownerId,
            input.uploadId,
            input.source?.messageId ?? null,
            input.source?.position ?? null,
          );

          return descriptor;
        }

        await repository.delete(tx, context.ownerId, input.uploadId);
      }

      await repository.deleteExpired(tx, context.ownerId, Date.now());
      await repository.pruneBlobs(tx, context.ownerId);

      if (deviceExport) {
        const known = await repository.knownExport(
          tx,
          context,
          descriptor,
          Date.now() + ATTACHMENT_REUSE_EXPIRY_MARGIN_MS,
        );

        if (known) {
          const result = attachmentSchema.parse(known.descriptor);

          const present = known.inline || (await repository.hasBlob(tx, context.ownerId, result.sha256));

          if (!present) {
            await reserveAttachmentBytes(repository, tx, context.ownerId, input.bytes.length);
            await repository.insertBlob(tx, context.ownerId, result.sha256, input.bytes);
          }

          if (input.source) {
            await repository.setSource(
              tx,
              context.ownerId,
              result.id,
              input.source.messageId,
              input.source.position,
            );
          }

          if (present) {
            onReuse?.();
          }

          return result;
        }
      }

      const blob = deviceExport ? await repository.hasBlob(tx, context.ownerId, descriptor.sha256) : false;

      await reserveAttachmentBytes(repository, tx, context.ownerId, blob ? 0 : input.bytes.length);

      if (deviceExport) {
        await repository.insertBlob(tx, context.ownerId, descriptor.sha256, input.bytes);
      }

      const now = Date.now();

      await repository.insert(tx, context, {
        id: input.uploadId,
        descriptor: JSON.stringify(descriptor),
        bytes: deviceExport ? null : input.bytes,
        createdAt: now,
        expiresAt: now + ATTACHMENT_TTL_MS,
        blobSha256: deviceExport ? descriptor.sha256 : null,
        deviceExport,
        sourceMessageId: input.source?.messageId ?? null,
        sourcePosition: input.source?.position ?? null,
      });

      return descriptor;
    });
  }

  async read(context: AttachmentContext, id: string) {
    const row = await this.repository.read(context, id);

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if (Number(row.expires_at) <= Date.now()) {
      throw new Fault(AttachmentFaultCode.Expired);
    }

    if (!row.bytes) {
      throw new Fault(AttachmentFaultCode.RebuildRequired);
    }

    return { descriptor: attachmentSchema.parse(row.descriptor), bytes: row.bytes };
  }

  async available(context: AttachmentContext, id: string) {
    return this.repository.available(context, id, Date.now());
  }
  async source(context: AttachmentContext, id: string) {
    const row = await this.repository.source(context, id, Date.now());

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return { messageId: row.source_message_id, position: row.source_position };
  }

  async validate(context: AttachmentContext, descriptors: AttachmentDescriptor[]) {
    const rows = await this.repository.descriptors(
      context,
      descriptors.map((item) => item.id),
    );

    const stored = new Map(rows.map((row) => [row.id, row]));

    for (const descriptor of descriptors) {
      const row = stored.get(descriptor.id);

      if (!row) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      if (Number(row.expires_at) <= Date.now()) {
        throw new Fault(AttachmentFaultCode.Expired);
      }

      if (JSON.stringify(attachmentSchema.parse(row.descriptor)) !== JSON.stringify(descriptor)) {
        throw new Fault(AttachmentFaultCode.Mismatch);
      }
    }
  }
}
