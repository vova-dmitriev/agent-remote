import { createHash } from 'node:crypto';
import { type RedisCache } from '../infrastructure/redis.js';
import {
  accountPreferencesSchema,
  preferencePatchSchema,
  type AccountPreferences,
  type PreferencePatch,
} from '@protocol';
import { type Database } from '../db/database.js';
import { type Principal } from '../auth/security.js';

export class PreferenceService {
  constructor(
    private db: Database,
    private cache?: RedisCache,
  ) {}

  async get(principal: Principal): Promise<AccountPreferences> {
    const load = async (): Promise<AccountPreferences> => {
      const result = await this.db.pool.query<AccountPreferences>(
        'SELECT language,theme FROM user_preferences WHERE owner_id=$1',
        [principal.userId],
      );

      return result.rows[0] ?? { language: null, theme: null };
    };

    return this.cache
      ? this.cache.rememberMutable(
          this.key(principal),
          (value) => accountPreferencesSchema.parse(value),
          load,
        )
      : load();
  }
  private key(principal: Principal) {
    return 'preferences:' + createHash('sha256').update(principal.userId).digest('hex');
  }

  async update(principal: Principal, input: PreferencePatch): Promise<AccountPreferences> {
    const patch = preferencePatchSchema.parse(input);

    const result = await this.db.pool.query<AccountPreferences>(
      `INSERT INTO user_preferences(owner_id,language,theme) VALUES($1,$2,$3)
       ON CONFLICT(owner_id) DO UPDATE SET
       language=COALESCE(EXCLUDED.language,user_preferences.language),
       theme=COALESCE(EXCLUDED.theme,user_preferences.theme)
       RETURNING language,theme`,
      [principal.userId, patch.language ?? null, patch.theme ?? null],
    );

    await this.cache?.invalidateMutable(this.key(principal));

    return result.rows[0]!;
  }
}
