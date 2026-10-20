import { createHash } from 'node:crypto';
import { type RedisCache } from '../infrastructure/redis.js';
import {
  accountPreferencesSchema,
  preferencePatchSchema,
  type AccountPreferences,
  type PreferencePatch,
} from '@protocol';
import { type PreferenceRepository } from './repository.js';
import { type Principal } from '../auth/security.js';

export class PreferenceService {
  constructor(
    private preferences: PreferenceRepository,
    private cache?: RedisCache,
  ) {}

  async get(principal: Principal): Promise<AccountPreferences> {
    const load = async (): Promise<AccountPreferences> =>
      (await this.preferences.find(principal.userId)) ?? { language: null, theme: null };

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

    const saved = await this.preferences.save(principal.userId, patch.language ?? null, patch.theme ?? null);

    await this.cache?.invalidateMutable(this.key(principal));

    return saved;
  }
}
