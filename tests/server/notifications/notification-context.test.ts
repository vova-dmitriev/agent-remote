import { afterAll, beforeAll, expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/relay/database.js';
import { NotificationDelivery } from '@server/notifications/delivery.js';
import { NotificationRepository } from '@server/notifications/repositories/notifications.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();

  for (const owner of ['mine', 'other']) {
    await fixture.db.pool.query(
      'INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES($1,$1,0,$1)',
      [owner],
    );

    await fixture.db.pool.query(
      'INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$1,$1)',
      [owner + '-device', owner],
    );

    await fixture.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
      owner,
      owner + '-device',
      'shared-id',
      JSON.stringify({
        title: owner === 'mine' ? 'Fix mobile layout' : 'PRIVATE OTHER TITLE',
        target: { kind: 'codex-cli' },
      }),
    ]);
  }
});

afterAll(async () => fixture?.close());

async function message(owner: string, seq: number, role: string, text: string, at: number) {
  const data = { type: 'message', payload: { role, text } };

  await fixture.db.pool.query(
    'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [owner, owner + '-device', 'stream', seq, owner + seq, 'shared-id', at, JSON.stringify(data)],
  );
}

async function send(id: string, at: number) {
  await fixture.db.pool.query(
    'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,0)',
    [id, 'mine', 'shared-id', 'turn_end', at],
  );

  const sent: Array<{ text: string; reply_markup: unknown }> = [];

  const delivery = new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid',
    async (body) => {
      sent.push(body as (typeof sent)[number]);

      return { ok: true };
    },
  );

  await delivery.deliver(Date.now(), id);

  return sent[0]!;
}

it('identifies the source/session and includes its own answer preview with a direct session link', async () => {
  await message('mine', 1, 'assistant', '**Fixed** mobile layout.\nTests pass.', 100);
  await message('other', 1, 'assistant', 'PRIVATE OTHER ANSWER', 150);
  const result = await send('context', 200);

  expect(result.text).toContain('Codex');
  expect(result.text).toContain('Fix mobile layout');
  expect(result.text).toContain('<b>Fixed</b> mobile layout.\nTests pass.');
  expect(result.text).not.toContain('PRIVATE');
  expect(result.text).not.toContain('**');
  expect(JSON.stringify(result.reply_markup)).toContain('#session=shared-id');
});

it('never describes a future answer or an earlier assistant answer as the current result', async () => {
  await message('mine', 2, 'user', 'New question', 300);
  await message('mine', 3, 'assistant', 'FUTURE ANSWER', 500);
  const result = await send('no-preview', 400);

  expect(result.text).toContain('Fix mobile layout');
  expect(result.text).not.toContain('Fixed mobile');
  expect(result.text).not.toContain('FUTURE');
  expect(result.text).toContain('Открой сессию');
});

it('does not expose context for a revoked device', async () => {
  await fixture.db.pool.query('UPDATE devices SET revoked_at=1 WHERE id=$1', ['mine-device']);
  const result = await send('revoked', 600);

  expect(result.text).not.toContain('Fix mobile layout');
  expect(result.text).not.toContain('FUTURE');
});
