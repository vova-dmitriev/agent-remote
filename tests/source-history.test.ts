import { expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { databaseFixture } from './helpers/database.js';
import { SourceHistory } from '../apps/server/src/history/source.js';
import { HistoryRepository } from '../apps/server/src/history/repository.js';
import type { Principal } from '../apps/server/src/auth/security.js';
import type { HistoryRead, ServerFrame } from '@protocol';

it('authorizes native page requests and fences responses by owner, device, epoch, session and generation', async () => {
  const fixture = await databaseFixture();

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9999',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session',$1)",
      [JSON.stringify({ generation: 'g', capabilities: { historyWindow: true } })],
    );

    const connection = {
        socket: {} as WebSocket,
        epoch: 'epoch',
        device: { id: 'device', owner_id: 'owner' },
      },
      sent: ServerFrame[] = [];

    let dispatch!: () => void;

    const dispatched = new Promise<void>((resolve) => {
      dispatch = resolve;
    });

    const source = new SourceHistory(
      new HistoryRepository(fixture.db),
      new Map([['device', connection]]),
      (_socket, frame) => {
        sent.push(frame);
        dispatch();

        return true;
      },
    );

    await expect(source.page({ userId: 'foreign' } as Principal, 'session')).rejects.toThrow('NOT_FOUND');
    expect(sent).toHaveLength(0);
    const page = source.page({ userId: 'owner' } as Principal, 'session');

    await dispatched;
    const request = sent[0] as HistoryRead;
    const message = { id: 'native', role: 'assistant' as const, text: 'Synthetic', occurredAt: 1 };

    const item = {
      type: 'history_item' as const,
      requestId: request.requestId,
      sessionId: 'session',
      generation: 'g',
      message,
    };

    for (const changed of [
      { epoch: 'stale' },
      { device: { id: 'other', owner_id: 'owner' } },
      { device: { id: 'device', owner_id: 'foreign' } },
    ]) {
      source.accept({ ...connection, ...changed }, item);
    }

    source.accept(connection, { ...item, generation: 'stale' });
    source.accept(connection, { ...item, sessionId: 'other' });
    source.accept(connection, item);

    source.accept(connection, {
      type: 'history_done',
      requestId: request.requestId,
      sessionId: 'session',
      generation: 'g',
      before: 'cursor',
      after: null,
    });

    const result = await page;

    expect(result?.events.map((event) => event.payload)).toEqual([message]);
    expect(result?.nextCursor).toBe('source:cursor');
    expect(result?.afterCursor).toBeNull();
    source.close();
  } finally {
    await fixture.close();
  }
});
