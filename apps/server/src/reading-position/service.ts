import {
  ErrorCode,
  readingPositionResponseSchema,
  readingPositionSchema,
  type ReadingPosition,
  type ReadingPositionResponse,
} from '@protocol';
import { hash, type Principal } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type PoolClient } from 'pg';
import { type RedisCache } from '../infrastructure/redis.js';
import { type ReadingPositionRepository, type ReadingPositionRow } from './repository.js';

const parse = (row: ReadingPositionRow): ReadingPosition =>
  readingPositionSchema.parse({
    messageId: row.message_id,
    offset: row.pixel_offset,
    ...(row.cursor === null ? {} : { cursor: row.cursor }),
    updatedAt: Number(row.updated_at),
  });

export class ReadingPositionService {
  constructor(
    private positions: ReadingPositionRepository,
    private cache?: RedisCache,
  ) {}

  private async owned(principal: Principal, sessionId: string, options?: { tx: PoolClient; lock: boolean }) {
    const deviceId = await this.positions.sessionDevice(principal.userId, sessionId, options);

    if (!deviceId) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return deviceId;
  }

  private key(owner: string, device: string, session: string) {
    return 'reading-position:' + hash(JSON.stringify([owner, device, session]));
  }

  async get(principal: Principal, sessionId: string): Promise<ReadingPositionResponse> {
    const deviceId = await this.owned(principal, sessionId);

    const load = async (): Promise<ReadingPositionResponse> => {
      const row = await this.positions.find(principal.userId, deviceId, sessionId);

      return { position: row ? parse(row) : null };
    };

    return this.cache
      ? this.cache.rememberMutable(
          this.key(principal.userId, deviceId, sessionId),
          (value) => readingPositionResponseSchema.parse(value),
          load,
        )
      : load();
  }

  async update(principal: Principal, sessionId: string, input: unknown): Promise<ReadingPositionResponse> {
    const position = readingPositionSchema.parse(input);

    if (position.updatedAt > Date.now() + 60_000) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const saved = await this.positions.transaction(async (tx) => {
      const deviceId = await this.owned(principal, sessionId, { tx, lock: true });

      const current =
        (await this.positions.saveNewer(tx, principal.userId, deviceId, sessionId, position)) ??
        (await this.positions.find(principal.userId, deviceId, sessionId, tx))!;

      return { deviceId, position: parse(current) };
    });

    await this.cache?.invalidateMutable(this.key(principal.userId, saved.deviceId, sessionId));

    return { position: saved.position };
  }
}
