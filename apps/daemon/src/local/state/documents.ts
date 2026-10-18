import { ErrorCode } from '../../../../../packages/protocol/src/index.js';
import type { LocalDatabase } from './database.js';
import type { LocalDocumentKind } from './values.js';

export interface LocalDocument {
  revision: number;
  value: unknown;
}

export class LocalDocuments {
  constructor(private database: LocalDatabase) {}

  transaction<T>(work: () => T): T {
    return this.database.connection.transaction(work)();
  }

  list(kind: LocalDocumentKind) {
    return (
      this.database.connection
        .prepare('SELECT owner,session,revision,value FROM local_documents WHERE kind=? LIMIT 1024')
        .all(kind) as { owner: string; session: string; revision: number; value: string }[]
    ).map((row) => ({ ...row, value: JSON.parse(row.value) as unknown }));
  }

  get(owner: string, session: string, kind: LocalDocumentKind): LocalDocument {
    const row = this.database.connection
      .prepare('SELECT revision,value FROM local_documents WHERE owner=? AND session=? AND kind=?')
      .get(owner, session, kind) as { revision: number; value: string } | undefined;

    return row
      ? { revision: row.revision, value: JSON.parse(row.value) as unknown }
      : { revision: 0, value: null };
  }

  save(
    owner: string,
    session: string,
    kind: LocalDocumentKind,
    revision: number,
    value: unknown,
  ): LocalDocument {
    return this.database.connection.transaction(() => {
      const previous = this.get(owner, session, kind);

      if (previous.revision !== revision || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      const next = revision + 1;

      this.database.connection
        .prepare(
          'INSERT INTO local_documents VALUES(?,?,?,?,?) ON CONFLICT(owner,session,kind) DO UPDATE SET revision=excluded.revision,value=excluded.value',
        )
        .run(owner, session, kind, next, JSON.stringify(value));

      return { revision: next, value };
    })();
  }
}
