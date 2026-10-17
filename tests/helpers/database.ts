import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Database } from '../../apps/server/src/db/database.js';

export async function databaseFixture() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

  const schema = 'redis_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Database(url, schema);

  await db.migrate();

  return {
    db,
    url,
    schema,
    async close() {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
