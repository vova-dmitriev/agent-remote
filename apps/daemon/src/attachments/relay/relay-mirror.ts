import { ATTACHMENT_TTL_MS, attachmentSchema, type AttachmentDescriptor, type Session } from '@protocol';
import { AttachmentErrorCode, RETRYABLE_ATTACHMENT_ERRORS } from '../errors.js';
import { ATTACHMENT_EXPORT_RESPONSE_MAX_BYTES, ATTACHMENT_MAX_EXPORTED_DESCRIPTORS } from '../limits.js';
import { boundedBody } from './io.js';
import type { LocalAttachmentBackend } from './local-backend.js';
import type { PreparedAttachment } from '../types.js';

type RelayRequest = (session: Session, id?: string, init?: RequestInit) => Promise<Response>;

export class RelayAttachmentMirror {
  private aliases = new Map<string, { descriptor: AttachmentDescriptor; expiresAt: number }>();
  constructor(
    private local: LocalAttachmentBackend | undefined,
    private enabled: boolean,
    private request: RelayRequest,
  ) {}

  private key(session: Session, descriptor: AttachmentDescriptor) {
    return JSON.stringify([session.target.deviceId, session.id, session.generation, descriptor]);
  }

  async prepare(session: Session, descriptor: AttachmentDescriptor, bytes: Buffer): Promise<void> {
    if (!this.enabled || !this.local) {
      return;
    }

    try {
      const response = await this.request(session, undefined, {
        method: 'POST',
        headers: {
          'x-upload-id': descriptor.id,
          'x-file-name': encodeURIComponent(descriptor.name),
          'x-session-generation': session.generation,
          'Content-Type': descriptor.mimeType,
        },
        body: new Uint8Array(bytes),
      });

      const content = await boundedBody(response, ATTACHMENT_EXPORT_RESPONSE_MAX_BYTES);
      const value = attachmentSchema.parse(JSON.parse(content.toString('utf8')));

      if (
        value.sha256 !== descriptor.sha256 ||
        value.byteLength !== descriptor.byteLength ||
        value.name !== descriptor.name ||
        value.mimeType !== descriptor.mimeType ||
        value.kind !== descriptor.kind
      ) {
        throw new Error(AttachmentErrorCode.IntegrityFailed);
      }

      // Publish a canonical history ID only after both readers can resolve it.
      await this.local.importDescriptor(session, value, bytes);
      const key = this.key(session, descriptor);

      this.aliases.delete(key);
      this.aliases.set(key, { descriptor: value, expiresAt: Date.now() + ATTACHMENT_TTL_MS });

      while (this.aliases.size > ATTACHMENT_MAX_EXPORTED_DESCRIPTORS) {
        this.aliases.delete(this.aliases.keys().next().value!);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (RETRYABLE_ATTACHMENT_ERRORS.has(error.message) || error.message === AttachmentErrorCode.Quota)
      ) {
        return;
      }

      throw error;
    }
  }

  history(session: Session, prepared: readonly PreparedAttachment[]): PreparedAttachment[] {
    const mapped = prepared.map((item) => {
      const key = this.key(session, item.descriptor);
      const known = this.aliases.get(key);

      if (!known) {
        return item;
      }

      if (known.expiresAt <= Date.now()) {
        this.aliases.delete(key);

        return item;
      }

      return { ...item, descriptor: structuredClone(known.descriptor) };
    });

    // Relay deduplication must not create invalid duplicate IDs in durable history.
    const unique = new Set(mapped.map((item) => item.descriptor.id));

    return unique.size === mapped.length ? mapped : [...prepared];
  }

  close() {
    this.aliases.clear();
  }
}
