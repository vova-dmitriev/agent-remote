import type { LocalDatabase } from '../../../local/state/database.js';
import { ExecutionOwnershipKind } from './execution-values.js';

export function createExecutionReferenceSchema(database: LocalDatabase) {
  database.connection.exec(
    `CREATE TABLE IF NOT EXISTS profile_execution_refs(owner TEXT NOT NULL,device TEXT NOT NULL,profile TEXT NOT NULL,ref TEXT NOT NULL,socket TEXT,pid INTEGER,ready INTEGER NOT NULL DEFAULT 0,kind TEXT NOT NULL DEFAULT '${ExecutionOwnershipKind.Execution}',operation TEXT,created INTEGER NOT NULL,PRIMARY KEY(owner,device,ref)); CREATE INDEX IF NOT EXISTS profile_execution_refs_profile ON profile_execution_refs(owner,device,profile);`,
  );

  for (const [name, declaration] of [
    ['pid', 'INTEGER'],
    ['kind', `TEXT NOT NULL DEFAULT '${ExecutionOwnershipKind.Execution}'`],
    ['operation', 'TEXT'],
  ]) {
    const columns = database.connection.prepare('PRAGMA table_info(profile_execution_refs)').all() as {
      name: string;
    }[];

    if (!columns.some((column) => column.name === name)) {
      database.connection.exec(`ALTER TABLE profile_execution_refs ADD COLUMN ${name} ${declaration}`);
    }
  }
}
