import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from '../../helpers/relay/database.js';
import { NotificationDelivery } from '@server/notifications/delivery.js';
import { NotificationRepository } from '@server/notifications/repositories/notifications.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();

  for (const id of ['a', 'b', 'blocked']) {
    await fixture.db.pool.query(
      'INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES($1,$1,0,$1)',
      [id],
    );
  }
});

afterAll(async () => {
  await fixture?.close();
});

async function outbox(owner = 'a') {
  const id = randomUUID();

  await fixture.db.pool.query(
    'INSERT INTO notification_outbox(id,owner_id,kind,session_id,created_at,next_attempt_at) VALUES($1,$2,$3,$4,0,0)',
    [id, owner, 'permission', 'synthetic-session'],
  );

  return id;
}

it('sends only to the persisted private recipient and skips an already sent outbox row', async () => {
  const id = await outbox();
  const calls: unknown[] = [];

  const delivery = new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid',
    async (body) => {
      calls.push(body);

      return { ok: true };
    },
  );

  expect(await delivery.deliver(Date.now(), id)).toBe(0);
  expect(await delivery.deliver(Date.now(), id)).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ chat_id: 'a', text: 'An agent is asking for permission.' });
});

it('writes in the language the recipient chose in the app, English otherwise', async () => {
  for (const id of ['ru', 'en']) {
    await fixture.db.pool.query(
      'INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES($1,$1,0,$1)',
      [id],
    );
  }

  await fixture.db.pool.query("INSERT INTO user_preferences(owner_id,language) VALUES('ru','ru')");

  // A fresh delivery per recipient: one delivery paces chats, which is not what this checks.
  const sent = async (owner: string) => {
    let body: { text: string; reply_markup: { inline_keyboard: { text: string }[][] } } | undefined;

    await new NotificationDelivery(
      new NotificationRepository(fixture.db),
      'https://example.invalid',
      async (value) => {
        body = value as typeof body;

        return { ok: true };
      },
    ).deliver(Date.now(), await outbox(owner));

    return [body!.text, body!.reply_markup.inline_keyboard[0]![0]!.text];
  };

  expect(await sent('ru')).toEqual(['Агент запрашивает разрешение.', 'Открыть сессию']);
  expect(await sent('en')).toEqual(['An agent is asking for permission.', 'Open session']);
});

it('locks a row across competing consumers so only one sends it', async () => {
  const id = await outbox('b');
  let sends = 0;

  const send = async () => {
    sends++;
    await new Promise((resolve) => setTimeout(resolve, 40));

    return { ok: true };
  };

  const a = new NotificationDelivery(new NotificationRepository(fixture.db), 'https://example.invalid', send);
  const b = new NotificationDelivery(new NotificationRepository(fixture.db), 'https://example.invalid', send);

  await Promise.all([a.deliver(Date.now(), id), b.deliver(Date.now(), id)]);
  expect(sends).toBe(1);
});

it('honors Telegram retry_after without resending before the stored deadline', async () => {
  const id = await outbox();
  let sends = 0;

  const delivery = new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid',
    async () => {
      sends++;

      return { ok: false, error_code: 429, parameters: { retry_after: 2 } };
    },
  );

  const now = Date.now();

  expect(await delivery.deliver(now, id)).toBe(2000);
  expect(await delivery.deliver(now + 100, id)).toBe(1900);
  expect(sends).toBe(1);
});

it('disables notifications after a blocked bot response and does not send later jobs', async () => {
  let sends = 0;

  const delivery = new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid',
    async () => {
      sends++;

      return { ok: false, error_code: 403 };
    },
  );

  await delivery.deliver(Date.now(), await outbox('blocked'));
  await delivery.deliver(Date.now() + 2000, await outbox('blocked'));
  expect(sends).toBe(1);

  expect(
    (await fixture.db.pool.query("SELECT notifications_enabled FROM users WHERE id='blocked'")).rows[0]
      .notifications_enabled,
  ).toBe(false);
});
