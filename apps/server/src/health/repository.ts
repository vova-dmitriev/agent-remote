import { sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';

export class HealthRepository {
  constructor(private readonly db: Database) {}

  async ping() {
    await this.db.orm.execute(sql`SELECT 1`);
  }
}
