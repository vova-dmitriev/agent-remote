import { randomUUID } from 'node:crypto';
import { ErrorCode, MAX_ATTACHMENT_BYTES, type Session } from '../../../../../packages/protocol/src/index.js';
import { attachmentSourceCurrent } from '../../attachments/source-current.js';
import { MediaCatalog } from './catalog.js';
import { MediaTransfers } from './transfers.js';
import { validateUpload, type LocalMediaOptions } from './types.js';

export class TrustedMedia {
  private closed = false;
  private readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  constructor(
    private options: LocalMediaOptions,
    private catalog: MediaCatalog,
    private transfers: MediaTransfers,
  ) {}

  assert(source: Session) {
    if (this.closed) {
      throw new Error(ErrorCode.ATTACHMENT_UNAVAILABLE);
    }

    if (!attachmentSourceCurrent(this.options.session(source.id), source)) {
      throw new Error(ErrorCode.STALE_SESSION);
    }
  }

  async request(source: Session, id?: string, init: RequestInit = {}): Promise<Response | null> {
    this.assert(source);

    if (id) {
      const descriptor = this.catalog.get(source.id, id);

      if (!descriptor) {
        return null;
      }

      if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
        throw new Error(ErrorCode.INVALID_REQUEST);
      }

      const bytes = this.catalog.bytes(descriptor);

      this.assert(source);

      return new Response(init.method === 'HEAD' ? null : new Uint8Array(bytes), {
        headers: { 'content-type': descriptor.mimeType, 'content-length': String(bytes.length) },
      });
    }

    if (init.method !== 'POST' || !init.body) {
      return null;
    }

    const headers = new Headers(init.headers);

    if (headers.get('x-session-generation') !== source.generation) {
      throw new Error(ErrorCode.STALE_SESSION);
    }

    const bytes = await this.body(init, () => this.assert(source));

    this.assert(source);

    const metadata = {
      uploadId: headers.get('x-upload-id') ?? '',
      name: decodeURIComponent(headers.get('x-file-name') ?? ''),
      mimeType: headers.get('content-type') ?? '',
      byteLength: bytes.length,
      ...(headers.has('x-source-message-id') && headers.has('x-source-position')
        ? {
            source: {
              messageId: headers.get('x-source-message-id')!,
              position: headers.get('x-source-position')!,
            },
          }
        : {}),
    };

    validateUpload(metadata);
    const cached = !!this.catalog.upload(source.id, metadata.uploadId);

    this.transfers.reserve(source.id, bytes.length);
    const idStage = randomUUID();

    this.catalog.files.create(idStage);

    try {
      this.catalog.files.append(idStage, 0, bytes);
      this.assert(source);
      const descriptor = this.catalog.finish(idStage, source, metadata);

      return Response.json(descriptor, { headers: cached ? { 'x-attachment-cache-hit': '1' } : {} });
    } finally {
      this.catalog.files.remove(idStage, true);
    }
  }

  private async body(init: RequestInit, current: () => void): Promise<Buffer> {
    const reader = new Response(init.body).body!.getReader();

    this.readers.add(reader);
    const parts: Uint8Array[] = [];
    let length = 0;

    try {
      while (true) {
        current();
        init.signal?.throwIfAborted();
        const result = await reader.read();

        current();
        init.signal?.throwIfAborted();

        if (result.done) {
          break;
        }

        length += result.value.length;

        if (length > MAX_ATTACHMENT_BYTES) {
          throw new Error(ErrorCode.ATTACHMENT_TOO_LARGE);
        }

        parts.push(result.value);
      }

      return Buffer.concat(parts, length);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      this.readers.delete(reader);
    }
  }
  close() {
    this.closed = true;

    for (const reader of this.readers) {
      void reader.cancel().catch(() => {});
    }
  }
}
