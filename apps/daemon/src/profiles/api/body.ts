import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import { ProfileApiLimit } from './values.js';

export async function profileApiBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
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
        throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
      }

      chunks.push(value);
    }

    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
