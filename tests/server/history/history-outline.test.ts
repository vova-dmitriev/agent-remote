import { expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  HISTORY_OUTLINE_TEXT_CHARS,
  RelayProtocolFeature,
  type HistoryRead,
  type ServerFrame,
} from '@protocol';
import { databaseFixture } from '../../helpers/relay/database.js';
import { SessionHistory } from '@server/history/service.js';
import { SourceHistory } from '@server/history/source.js';
import { HistoryRepository } from '@server/history/repository.js';
import type { Principal } from '@server/auth/security.js';

async function owned(data: object) {
  const fixture = await databaseFixture();

  await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9999',0)");

  await fixture.db.pool.query(
    "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
  );

  await fixture.db.pool.query(
    "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session',$1)",
    [JSON.stringify(data)],
  );

  return fixture;
}

it("outlines the relay's stored owner messages in order, shortened, for the owner only", async () => {
  const fixture = await owned({});

  try {
    for (let seq = 1; seq <= 300; seq++) {
      const payload = {
        id: 'm' + seq,
        role: seq % 3 ? 'assistant' : 'user',
        text: seq === 3 ? 'x'.repeat(HISTORY_OUTLINE_TEXT_CHARS * 2) : 'Synthetic ' + seq,
        occurredAt: seq,
        ...(seq === 6 ? { tool: { id: 't', name: 'Bash', phase: 'started' } } : {}),
      };

      const event = {
        version: 1,
        deviceId: 'device',
        streamId: 'stream',
        seq,
        eventId: 'e' + seq,
        sessionId: 'session',
        occurredAt: seq,
        type: 'message',
        payload,
      };

      await fixture.db.pool.query(
        'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        ['owner', 'device', 'stream', seq, event.eventId, 'session', seq, JSON.stringify(event)],
      );
    }

    const history = new SessionHistory(new HistoryRepository(fixture.db));
    const outline = await history.outline({ userId: 'owner' } as Principal, 'session');

    expect(outline.map((message) => message.id)).toEqual(
      Array.from({ length: 100 }, (_, i) => 'm' + (i + 1) * 3).filter((id) => id !== 'm6'),
    );

    expect(outline[0]!.text).toHaveLength(HISTORY_OUTLINE_TEXT_CHARS);

    // Search reads every stored message, and matches words in any letter case.
    await fixture.db.pool.query(
      "UPDATE events SET data=jsonb_set(data,'{payload,text}','\"Финальный ДЕПЛОЙ\"') WHERE seq=5",
    );

    const found = await history.search({ userId: 'owner' } as Principal, 'session', 'деплой');

    expect(found.map((message) => message.id)).toEqual(['m5']);

    await expect(history.search({ userId: 'stranger' } as Principal, 'session', 'деплой')).rejects.toThrow(
      'NOT_FOUND',
    );

    await expect(history.outline({ userId: 'stranger' } as Principal, 'session')).rejects.toThrow(
      'NOT_FOUND',
    );
  } finally {
    await fixture.close();
  }
});

it('asks only a device that speaks the outline protocol, and takes more than a page from it', async () => {
  const fixture = await owned({ generation: 'g', capabilities: { historyWindow: true } });

  try {
    const sent: ServerFrame[] = [];

    const connection = {
      socket: {} as WebSocket,
      epoch: 'epoch',
      device: { id: 'device', owner_id: 'owner' },
      protocolVersion: 13,
    };

    const live = new Map([['device', connection]]);

    const source = new SourceHistory(new HistoryRepository(fixture.db), live, (_socket, frame) => {
      sent.push(frame);

      return true;
    });

    const principal = { userId: 'owner' } as Principal;

    expect(await source.outline(principal, 'session')).toBeNull();
    expect(await source.search(principal, 'session', 'words')).toBeNull();
    expect(sent).toHaveLength(0);
    connection.protocolVersion = RelayProtocolFeature.HistoryOutline;
    const outline = source.outline(principal, 'session');

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const request = sent[0] as HistoryRead;

    expect(request).toMatchObject({ type: 'history_read', direction: 'outline' });

    for (let i = 0; i < 150; i++) {
      source.accept(connection, {
        type: 'history_item',
        requestId: request.requestId,
        sessionId: 'session',
        generation: 'g',
        message: { id: 'u' + i, role: 'user', text: 'Synthetic ' + i, occurredAt: i },
      });
    }

    source.accept(connection, {
      type: 'history_done',
      requestId: request.requestId,
      sessionId: 'session',
      generation: 'g',
      before: null,
      after: null,
    });

    expect((await outline)?.events).toHaveLength(150);
    source.close();
  } finally {
    await fixture.close();
  }
});
