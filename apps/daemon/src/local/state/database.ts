import Sqlite from 'better-sqlite3';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ErrorCode } from '@protocol';

export class LocalDatabase {
  readonly connection: Sqlite.Database;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const parent = lstatSync(dirname(path));

      if (
        parent.isSymbolicLink() ||
        !parent.isDirectory() ||
        (process.getuid && parent.uid !== process.getuid())
      ) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      chmodSync(dirname(path), 0o700);

      try {
        const info = lstatSync(path);

        if (!info.isFile() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
          throw new Error(ErrorCode.UNAUTHORIZED);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    this.connection = new Sqlite(path);

    if (path !== ':memory:') {
      chmodSync(path, 0o600);
    }

    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('synchronous = FULL');

    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS local_documents(owner TEXT NOT NULL,session TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(owner,session,kind));
      CREATE TABLE IF NOT EXISTS local_grants(owner TEXT NOT NULL,client TEXT NOT NULL,origin TEXT NOT NULL,status TEXT NOT NULL,token_hash TEXT,expires_at INTEGER NOT NULL,PRIMARY KEY(owner,client,origin));
    `);
  }

  close() {
    this.connection.close();
  }
}
