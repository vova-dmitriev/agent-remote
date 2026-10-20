import { CodedError, ErrorCode, MAX_ATTACHMENT_BYTES } from '@protocol';
import { ASCII_CONTROL_CHARACTERS } from '../../validation/control-characters.js';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { logDebug } from '../../diagnostics/log.js';

export async function boundedBody(response: Response, maximum = MAX_ATTACHMENT_BYTES): Promise<Buffer> {
  const length = response.headers.get('content-length');

  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) {
    await response.body?.cancel();
    throw new CodedError(ErrorCode.ATTACHMENT_TOO_LARGE);
  }

  if (!response.body) {
    throw new CodedError(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
  }

  const reader = response.body.getReader(),
    chunks: Buffer[] = [];

  let total = 0;

  try {
    while (true) {
      const item = await reader.read();

      if (item.done) {
        break;
      }

      total += item.value.byteLength;

      if (total > maximum) {
        throw new CodedError(ErrorCode.ATTACHMENT_TOO_LARGE);
      }

      chunks.push(Buffer.from(item.value));
    }

    return Buffer.concat(chunks, total);
  } finally {
    await reader.cancel().catch((error: unknown) => logDebug('attachments/relay/io', error));
    reader.releaseLock();
  }
}

/** Only called for an explicit native media record, never model text/tool arguments. */
export async function nativeFile(path: string): Promise<Buffer> {
  if (!isAbsolute(path) || path.startsWith('//') || ASCII_CONTROL_CHARACTERS.test(path)) {
    throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
  }

  const canonical = await realpath(path);
  const normalized = resolve(path);

  // macOS exposes its temporary directories through these system aliases.
  // Any additional file or directory symlink must still fail the exact-path check.
  const expected =
    process.platform === 'darwin' && /^\/(?:tmp|var)(?:\/|$)/u.test(normalized)
      ? '/private' + normalized
      : normalized;

  if (canonical !== expected) {
    throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
  }

  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const info = await file.stat();

    if (
      !info.isFile() ||
      (process.getuid && info.uid !== process.getuid()) ||
      !info.size ||
      info.size > MAX_ATTACHMENT_BYTES
    ) {
      throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
    }

    const current = await stat(path);

    if (current.dev !== info.dev || current.ino !== info.ino || (await realpath(path)) !== canonical) {
      throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
    }

    const bytes = Buffer.alloc(info.size);
    let offset = 0;

    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);

      if (!read.bytesRead) {
        throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
      }

      offset += read.bytesRead;
    }

    const after = await file.stat();

    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
      throw new CodedError(ErrorCode.ATTACHMENT_SOURCE_UNAVAILABLE);
    }

    return bytes;
  } finally {
    await file.close();
  }
}
