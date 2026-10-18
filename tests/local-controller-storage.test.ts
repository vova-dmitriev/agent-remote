import { afterEach, expect, it } from 'vitest';
import { LocalDatabase } from '../apps/daemon/src/local/state/database.js';
import { LocalDocuments } from '../apps/daemon/src/local/state/documents.js';

const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

it('isolates local owners and atomically rejects stale revision writes', () => {
  const database = new LocalDatabase(':memory:');

  databases.push(database);
  const documents = new LocalDocuments(database);

  expect(documents.get('owner-a', 'session-a', 'reading')).toEqual({ revision: 0, value: null });

  expect(documents.save('owner-a', 'session-a', 'reading', 0, { messageId: 'middle' })).toEqual({
    revision: 1,
    value: { messageId: 'middle' },
  });

  expect(() => documents.save('owner-a', 'session-a', 'reading', 0, { messageId: 'last' })).toThrow(
    'LOCAL_REVISION_CONFLICT',
  );

  expect(documents.get('owner-a', 'session-a', 'reading').value).toEqual({ messageId: 'middle' });
  expect(documents.get('owner-b', 'session-a', 'reading')).toEqual({ revision: 0, value: null });
});
