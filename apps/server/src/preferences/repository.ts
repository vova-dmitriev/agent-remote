import type { AccountPreferences } from '@protocol';
import type { Database } from '../db/database.js';

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  async find(ownerId: string): Promise<AccountPreferences | undefined> {
    const result = await this.db.pool.query<AccountPreferences>(
      'SELECT language,theme FROM user_preferences WHERE owner_id=$1',
      [ownerId],
    );

    return result.rows[0];
  }

  async save(
    ownerId: string,
    language: AccountPreferences['language'],
    theme: AccountPreferences['theme'],
  ): Promise<AccountPreferences> {
    const result = await this.db.pool.query<AccountPreferences>(
      `INSERT INTO user_preferences(owner_id,language,theme) VALUES($1,$2,$3)
       ON CONFLICT(owner_id) DO UPDATE SET
       language=COALESCE(EXCLUDED.language,user_preferences.language),
       theme=COALESCE(EXCLUDED.theme,user_preferences.theme)
       RETURNING language,theme`,
      [ownerId, language, theme],
    );

    return result.rows[0]!;
  }
}
