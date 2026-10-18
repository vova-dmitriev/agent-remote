import { z } from 'zod';
import { LOCAL_LIMITS } from '../../../protocol/src/local-limits.js';
import { LocalKind } from '../../../protocol/src/values/local-client.js';
import { ErrorCode } from '../../../protocol/src/error-codes.js';
import { decodeBase64, encodeBase64 } from './base64.js';

const maximumSequence = Math.ceil(LOCAL_LIMITS.logicalBytes / LOCAL_LIMITS.chunkBytes) - 1;
const encodedChunkBytes = Math.ceil(LOCAL_LIMITS.chunkBytes / 3) * 4;

const schema = z.strictObject({
  kind: z.literal(LocalKind.Fragment),
  transferId: z.string().min(1).max(512),
  seq: z.number().int().nonnegative().max(maximumSequence),
  total: z.number().int().positive(),
  data: z.string().min(1).max(encodedChunkBytes),
});

type Fragment = z.infer<typeof schema>;
interface Pending {
  total: number;
  length: number;
  seq: number;
  expiresAt: number;
  parts: Uint8Array[];
}

export function fragmentValue(value: unknown, transferId: string): Fragment[] {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(ErrorCode.INVALID_FRAME);
  }

  if (!serialized || !transferId || transferId.length > 512) {
    throw new Error(ErrorCode.INVALID_FRAME);
  }

  const bytes = new TextEncoder().encode(serialized);

  if (bytes.length > LOCAL_LIMITS.logicalBytes) {
    throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  }

  const pieces: Fragment[] = [];

  for (let start = 0; start < bytes.length; start += LOCAL_LIMITS.chunkBytes) {
    pieces.push({
      kind: LocalKind.Fragment,
      transferId,
      seq: pieces.length,
      total: bytes.length,
      data: encodeBase64(bytes.subarray(start, start + LOCAL_LIMITS.chunkBytes)),
    });
  }

  return pieces;
}

export class FragmentReader {
  private pending = new Map<string, Pending>();
  private completed = new Map<string, number>();

  accept(raw: unknown, now = Date.now()): unknown {
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      if (raw && typeof raw === 'object' && 'transferId' in raw && typeof raw.transferId === 'string') {
        this.pending.delete(raw.transferId);
      }

      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const piece = parsed.data;
    const expired = (this.pending.get(piece.transferId)?.expiresAt ?? Infinity) <= now;

    this.expire(now);

    if (expired) {
      throw new Error(ErrorCode.LOCAL_TRANSFER_EXPIRED);
    }

    try {
      return this.append(piece, now);
    } catch (error) {
      this.pending.delete(piece.transferId);
      throw error;
    }
  }

  private append(piece: Fragment, now: number): unknown {
    if (piece.total > LOCAL_LIMITS.logicalBytes) {
      throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
    }

    if (this.completed.has(piece.transferId)) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const entry = this.pending.get(piece.transferId) ?? this.begin(piece, now);
    const padding = piece.data.endsWith('==') ? 2 : Number(piece.data.endsWith('='));
    const length = (piece.data.length / 4) * 3 - padding;

    if (
      entry.seq !== piece.seq ||
      entry.total !== piece.total ||
      length > LOCAL_LIMITS.chunkBytes ||
      entry.length + length > entry.total
    ) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const bytes = decodeBase64(piece.data);

    entry.parts.push(bytes);
    entry.seq++;
    entry.length += bytes.length;

    if (entry.length !== entry.total) {
      return undefined;
    }

    return this.complete(piece.transferId, entry, now);
  }

  private begin(piece: Fragment, now: number): Pending {
    const reserved = [...this.pending.values()].reduce((sum, item) => sum + item.total, 0);

    if (piece.seq !== 0) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    if (
      reserved + piece.total > LOCAL_LIMITS.pendingBytes ||
      this.pending.size >= LOCAL_LIMITS.maxTransfers
    ) {
      throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
    }

    const entry = {
      total: piece.total,
      length: 0,
      seq: 0,
      expiresAt: now + LOCAL_LIMITS.fragmentExpiryMs,
      parts: [],
    };

    this.pending.set(piece.transferId, entry);

    return entry;
  }

  private complete(id: string, entry: Pending, now: number): unknown {
    const joined = new Uint8Array(entry.total);
    let offset = 0;

    for (const part of entry.parts) {
      joined.set(part, offset);
      offset += part.length;
    }

    this.pending.delete(id);
    let result: unknown;

    try {
      result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    } catch {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    this.completed.set(id, now + LOCAL_LIMITS.fragmentExpiryMs);

    if (this.completed.size > LOCAL_LIMITS.maxTransfers) {
      this.completed.delete(this.completed.keys().next().value!);
    }

    return result;
  }

  private expire(now: number) {
    for (const [id, entry] of this.pending) {
      if (entry.expiresAt <= now) {
        this.pending.delete(id);
      }
    }

    for (const [id, expiry] of this.completed) {
      if (expiry <= now) {
        this.completed.delete(id);
      }
    }
  }

  clear() {
    this.pending.clear();
    this.completed.clear();
  }
}
