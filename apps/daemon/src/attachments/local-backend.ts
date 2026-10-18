import type { AttachmentDescriptor, Session } from '../../../../packages/protocol/src/index.js';

export interface LocalAttachmentBackend {
  request(session: Session, id?: string, init?: RequestInit): Promise<Response | null>;
  importDescriptor(session: Session, descriptor: AttachmentDescriptor, bytes: Uint8Array): Promise<void>;
}
