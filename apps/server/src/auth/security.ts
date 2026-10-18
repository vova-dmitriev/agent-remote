import { ErrorCode } from '../../../../packages/protocol/src/index.js';
import { MessageRole } from '../../../../packages/protocol/src/index.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export interface Principal {
  userId: string;
  telegramId: string;
}

export function telegramIdentity(raw: string, botToken: string, now = Date.now(), maxAge = 300_000): string {
  try {
    if (typeof raw !== 'string' || raw.length > 16_384) {
      throw new Error();
    }

    const params = new URLSearchParams(raw);
    const keys = [...params.keys()];

    if (new Set(keys).size !== keys.length) {
      throw new Error();
    }

    const signature = params.get('hash') ?? '';

    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      throw new Error();
    }

    params.delete('hash');

    const check = [...params]
      .sort(([a], [b]) => {
        if (a < b) {
          return -1;
        }

        if (a > b) {
          return 1;
        }

        return 0;
      })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = createHmac('sha256', key).update(check).digest();

    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      throw new Error();
    }

    const date = Number(params.get('auth_date')) * 1000;

    if (!Number.isSafeInteger(date) || date < now - maxAge || date > now + 30_000) {
      throw new Error();
    }

    const user = JSON.parse(params.get(MessageRole.User) ?? 'null') as { id?: unknown } | null;
    const id = user?.id;

    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
      return String(id);
    }

    if (typeof id === 'string' && /^[1-9][0-9]{0,18}$/.test(id)) {
      return id;
    }

    throw new Error();
  } catch {
    throw new Fault(ErrorCode.UNAUTHORIZED, 401);
  }
}

export class Limiter {
  private buckets = new Map<string, { count: number; until: number }>();
  take(key: string, limit: number, now = Date.now()): void {
    let bucket = this.buckets.get(key);

    if (!bucket && this.buckets.size >= 10000) {
      for (const [id, item] of this.buckets) {
        if (item.until <= now) {
          this.buckets.delete(id);
        }
      }

      if (this.buckets.size >= 10000) {
        throw new Fault(ErrorCode.RATE_LIMITED, 429);
      }
    }

    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + 60000 };
      this.buckets.set(key, bucket);
    }

    if (++bucket.count > limit) {
      throw new Fault(ErrorCode.RATE_LIMITED, 429);
    }
  }
}
