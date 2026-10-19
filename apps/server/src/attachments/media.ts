import { AttachmentKind, attachmentSchema } from '@protocol';
import { createHash } from 'node:crypto';

export function imageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }

  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return 'image/jpeg';
  }

  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return undefined;
}

export function describeAttachment(id: string, name: string, mimeType: string, bytes: Buffer) {
  const image = imageMime(bytes);

  return attachmentSchema.parse({
    id,
    name,
    mimeType: image ?? mimeType,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    kind: image ? AttachmentKind.Image : AttachmentKind.File,
  });
}
