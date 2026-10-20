import type { Database } from '../db/database.js';

export class HealthRepository {
  constructor(private readonly db: Database) {}

  async ping() {
    await this.db.pool.query('SELECT 1');
  }
}
