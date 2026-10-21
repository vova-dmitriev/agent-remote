import { EventType, PermissionDecision, RuleScopeKind } from '@protocol';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { NotificationDelivery } from '@server/notifications/delivery.js';
import { NotificationRepository } from '@server/notifications/repositories/notifications.js';
import { NotificationWorker } from '@server/notifications/worker.js';
import { databaseFixture } from '../../helpers/relay/database.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

const target = {
  kind: 'claude-code-cli',
  deviceId: 'mine-device',
  connectorId: 'c',
  claudeSessionId: 'claude-1',
};

beforeAll(async () => {
  fixture = await databaseFixture();

  for (const owner of ['mine', 'other']) {
    await fixture.db.pool.query(
      'INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES($1,$2,0,$2)',
      [owner, owner === 'mine' ? '1001' : '2002'],
    );
  }

  await fixture.db.pool.query("INSERT INTO user_preferences(owner_id,language) VALUES('mine','ru')");

  await fixture.db.pool.query(
    "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('mine-device','mine','t','g')",
  );

  await fixture.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    'mine',
    'mine-device',
    'session-1',
    JSON.stringify({ title: 'ETC-1374', target, generation: 'g1' }),
  ]);

  const data = {
    type: EventType.Permission,
    payload: {
      status: 'running',
      rule: { id: 'ready-database', name: 'Suspicious database queries', scope: RuleScopeKind.Project },
      command: 'psql -c "DELETE FROM orders" <x>',
      requestId: 'request-1',
      generation: 'g1',
    },
  };

  await fixture.db.pool.query(
    'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    ['mine', 'mine-device', 'stream', 1, 'event-1', 'session-1', Date.now(), JSON.stringify(data)],
  );

  await fixture.db.pool.query(
    'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,0)',
    ['outbox-1', 'mine', 'session-1', EventType.Permission, Date.now() + 1],
  );
});

afterAll(async () => fixture?.close());

it('sends ❗ with the command and three answers, and only the owner can answer, once', async () => {
  const sent: Array<{
    text: string;
    reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> };
  }> = [];

  const delivery = new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid',
    async (body) => {
      sent.push(body as (typeof sent)[number]);

      return { ok: true };
    },
  );

  await delivery.deliver(Date.now(), 'outbox-1');

  expect(sent[0]!.text).toBe(
    '❗ Claude хочет выполнить команду по правилу «Опасные запросы к БД» · ETC-1374\n\n<code>psql -c "DELETE FROM orders" &lt;x&gt;</code>',
  );

  const [answers] = sent[0]!.reply_markup.inline_keyboard;
  const deny = answers!.find((button) => button.callback_data?.startsWith('d:'))!.callback_data!;

  expect(answers!.map((button) => button.callback_data?.[0])).toEqual(['a', 'A', 'd']);

  const command = vi.fn(async () => ({ commandId: 'c', status: 'dispatched' }));
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  const worker = new NotificationWorker(
    fixture.db,
    'synthetic',
    'https://example.invalid',
    (async (url: string, init: { body: string }) => {
      calls.push({ method: url.split('/').at(-1)!, body: JSON.parse(init.body) });

      return new Response(JSON.stringify({ ok: true, result: true }));
    }) as unknown as typeof fetch,
    undefined,
    command,
  );

  const press = (from: number, data: string) => ({
    update_id: from,
    callback_query: { id: 'cb', from: { id: from }, data },
  });

  await worker.updates([press(2002, deny)]);
  expect(command).not.toHaveBeenCalled();

  await worker.updates([press(1001, deny)]);

  expect(command).toHaveBeenCalledWith(
    { userId: 'mine', telegramId: '1001' },
    expect.objectContaining({
      target,
      sessionId: 'session-1',
      generation: 'g1',
      action: { type: 'permission', requestId: 'request-1', decision: PermissionDecision.Deny },
    }),
  );

  await worker.updates([press(1001, deny)]);
  expect(command).toHaveBeenCalledTimes(1);

  expect(calls.filter((call) => call.method === 'answerCallbackQuery').map((call) => call.body.text)).toEqual(
    ['This request is not yours or is already closed.', 'Отказано.', 'Этот запрос не ваш или уже закрыт.'],
  );
});
