import { CodedError, ErrorCode } from '@protocol';
import { ProfileApiLimit } from './values.js';
import { logDebug } from '../../diagnostics/log.js';

export async function profileApiBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > ProfileApiLimit.BodyBytes) {
        throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
      }

      chunks.push(value);
    }

    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }
  } finally {
    await reader.cancel().catch((error: unknown) => logDebug('profiles/api/body', error));
    reader.releaseLock();
  }
}
