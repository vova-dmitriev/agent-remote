import {
  ErrorCode,
  readingPositionResponseSchema,
  readingPositionSchema,
  type ReadingPosition,
  type ReadingPositionResponse,
} from '@protocol';
import { type Pool, type PoolClient } from 'pg';
import { hash, type Principal } from '../auth/security.js';
import { Fault } from '../http/fault.js';
import { type Database } from '../db/database.js';
import { type RedisCache } from '../infrastructure/redis.js';

type Row = { message_id: string; pixel_offset: number; cursor: string | null; updated_at: string };

const parse = (row: Row): ReadingPosition =>
  readingPositionSchema.parse({
    messageId: row.message_id,
    offset: row.pixel_offset,
    ...(row.cursor === null ? {} : { cursor: row.cursor }),
    updatedAt: Number(row.updated_at),
  });

export class ReadingPositionService {
  constructor(
    private db: Database,
    private cache?: RedisCache,
  ) {}

  private async owned(query: Pool | PoolClient, principal: Principal, sessionId: string, lock = false) {
    const result = await query.query<{ device_id: string }>(
      `SELECT s.device_id FROM sessions s JOIN devices d ON d.owner_id=s.owner_id AND d.id=s.device_id
       WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL${lock ? ' FOR SHARE OF d' : ''}`,
      [principal.userId, sessionId],
    );

    if (!result.rows[0]) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    return result.rows[0].device_id;
  }

  private key(owner: string, device: string, session: string) {
    return 'reading-position:' + hash(JSON.stringify([owner, device, session]));
  }

  async get(principal: Principal, sessionId: string): Promise<ReadingPositionResponse> {
    const deviceId = await this.owned(this.db.pool, principal, sessionId);

    const load = async (): Promise<ReadingPositionResponse> => {
      const result = await this.db.pool.query<Row>(
        'SELECT message_id,pixel_offset,cursor,updated_at FROM reading_positions WHERE owner_id=$1 AND device_id=$2 AND session_id=$3',
        [principal.userId, deviceId, sessionId],
      );

      return { position: result.rows[0] ? parse(result.rows[0]) : null };
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

    const saved = await this.db.transaction(async (tx) => {
      const deviceId = await this.owned(tx, principal, sessionId, true);

      const result = await tx.query<Row>(
        `INSERT INTO reading_positions(owner_id,device_id,session_id,message_id,pixel_offset,cursor,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,device_id,session_id) DO UPDATE SET
         message_id=EXCLUDED.message_id,pixel_offset=EXCLUDED.pixel_offset,cursor=EXCLUDED.cursor,updated_at=EXCLUDED.updated_at
         WHERE EXCLUDED.updated_at>reading_positions.updated_at RETURNING message_id,pixel_offset,cursor,updated_at`,
        [
          principal.userId,
          deviceId,
          sessionId,
          position.messageId,
          position.offset,
          position.cursor ?? null,
          position.updatedAt,
        ],
      );

      const current =
        result.rows[0] ??
        (
          await tx.query<Row>(
            'SELECT message_id,pixel_offset,cursor,updated_at FROM reading_positions WHERE owner_id=$1 AND device_id=$2 AND session_id=$3',
            [principal.userId, deviceId, sessionId],
          )
        ).rows[0]!;

      return { deviceId, position: parse(current) };
    });

    await this.cache?.invalidateMutable(this.key(principal.userId, saved.deviceId, sessionId));

    return { position: saved.position };
  }
}
