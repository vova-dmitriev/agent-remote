import { type AttachmentDescriptor } from '../../../../packages/protocol/src/index.js';

export interface PreparedAttachment {
  descriptor: AttachmentDescriptor;
  path: string;
}
export interface NativeMedia {
  name: string;
  mimeType: string;
  bytes?: Buffer;
  path?: string;
  /** Native Claude paste label, derived only from explicit imagePasteIds metadata. */
  placeholder?: string;
}
