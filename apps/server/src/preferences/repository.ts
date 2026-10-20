import type { AccountPreferences } from '@protocol';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { userPreferences } from '../db/schema/index.js';

const columns = { language: userPreferences.language, theme: userPreferences.theme };

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  async find(ownerId: string): Promise<AccountPreferences | undefined> {
    const [row] = await this.db.orm
      .select(columns)
      .from(userPreferences)
      .where(eq(userPreferences.ownerId, ownerId));

    return row as AccountPreferences | undefined;
  }

  /** Upserts the owner's preferences; a null field keeps the stored value. */
  async save(
    ownerId: string,
    language: AccountPreferences['language'],
    theme: AccountPreferences['theme'],
  ): Promise<AccountPreferences> {
    const [row] = await this.db.orm
      .insert(userPreferences)
      .values({ ownerId, language, theme })
      .onConflictDoUpdate({
        target: userPreferences.ownerId,
        set: {
          language: sql`coalesce(excluded.language, ${userPreferences.language})`,
          theme: sql`coalesce(excluded.theme, ${userPreferences.theme})`,
        },
      })
      .returning(columns);

    return row as AccountPreferences;
  }
}
