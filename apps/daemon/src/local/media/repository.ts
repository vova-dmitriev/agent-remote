import {
  type AttachmentDescriptor,
  CodedError,
  ErrorCode,
  LOCAL_LIMITS,
  type LocalAction,
  LocalOperation,
  type Session,
} from '@protocol';
import type { LocalPrincipal } from '../grants/types.js';
import { MediaCatalog } from './catalog.js';
import { MediaTransfers } from './transfers.js';
import { TrustedMedia } from './trusted.js';
import { MEDIA_LIMITS, type LocalMediaOptions } from './types.js';

export class LocalMediaRepository {
  private catalog: MediaCatalog;
  private transfers: MediaTransfers;
  private trusted: TrustedMedia;
  private closed = false;
  private requests = new Set<Promise<unknown>>();
  private maintenance: ReturnType<typeof setInterval>;

  constructor(private options: LocalMediaOptions) {
    this.catalog = new MediaCatalog(options);
    this.transfers = new MediaTransfers(options, this.catalog);
    this.trusted = new TrustedMedia(options, this.catalog, this.transfers);

    this.maintenance = setInterval(() => {
      try {
        this.transfers.prune();
        this.catalog.prune();
      } catch {
        /* A later request returns the storage error. */
      }
    }, MEDIA_LIMITS.maintenanceMs);

    this.maintenance.unref();
  }

  async execute(principal: LocalPrincipal, action: LocalAction): Promise<unknown> {
    this.assertOpen();

    switch (action.operation) {
      case LocalOperation.MediaBegin: {
        const source = this.transfers.authorization.session(principal, action.sessionId, action.generation);

        return this.transfers.begin(principal, source, action);
      }

      case LocalOperation.MediaChunk:
        return this.transfers.chunk(principal, action.transferId, action.offset, action.data);
      case LocalOperation.MediaFinish:
        return this.transfers.finish(principal, action.transferId);
      case LocalOperation.MediaAbort:
        return this.transfers.abort(principal, action.transferId);

      case LocalOperation.MediaRead: {
        const source = this.transfers.authorization.session(principal, action.sessionId);
        const descriptor = this.catalog.get(source.id, action.attachmentId);

        if (!descriptor) {
          throw new CodedError(ErrorCode.ATTACHMENT_UNAVAILABLE);
        }

        return this.transfers.read(principal, source, descriptor);
      }

      case LocalOperation.MediaReadChunk:
        return this.transfers.readChunk(principal, action.transferId, action.offset);
      default:
        throw new CodedError(ErrorCode.INVALID_REQUEST);
    }
  }

  request(session: Session, id?: string, init?: RequestInit): Promise<Response | null> {
    if (this.requests.size >= LOCAL_LIMITS.maxTransfers) {
      return Promise.reject(new CodedError(ErrorCode.ATTACHMENT_QUOTA));
    }

    const source = structuredClone(session);

    const run = (async () => {
      this.assertOpen();
      const response = await this.trusted.request(source, id, init);

      this.assertOpen();
      this.trusted.assert(source);

      return response;
    })();

    this.requests.add(run);
    void run.finally(() => this.requests.delete(run)).catch(() => {});

    return run;
  }

  async importDescriptor(
    session: Session,
    descriptor: AttachmentDescriptor,
    bytes: Uint8Array,
  ): Promise<void> {
    this.assertOpen();
    this.trusted.assert(session);

    if (!this.catalog.get(session.id, descriptor.id)) {
      this.transfers.reserve(session.id, bytes.length);
    }

    this.catalog.import(session, descriptor, bytes);
    this.trusted.assert(session);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.maintenance);
    this.trusted.close();
    await Promise.allSettled([...this.requests]);
    this.transfers.close();
    this.catalog.files.close();
  }

  private assertOpen() {
    if (this.closed) {
      throw new CodedError(ErrorCode.ATTACHMENT_UNAVAILABLE);
    }
  }
}
