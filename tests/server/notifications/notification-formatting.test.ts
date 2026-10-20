import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { NotificationDelivery } from '../../../apps/server/src/notifications/delivery.js';
import { NotificationRepository } from '../../../apps/server/src/notifications/repositories/notifications.js';
import { databaseFixture } from '../../helpers/database.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;

beforeAll(async () => {
  fixture = await databaseFixture();
});

afterAll(async () => {
  await fixture?.close();
});

interface SentMessage {
  chat_id: string;
  text: string;
  parse_mode?: string;
  link_preview_options?: { is_disabled: boolean };
  reply_markup: { inline_keyboard: Array<Array<{ web_app: { url: string } }>> };
}

async function deliver(
  text: string,
  options: { title?: string; kind?: string; reason?: string; errorCode?: string } = {},
) {
  const owner = randomUUID();
  const device = randomUUID();
  const id = randomUUID();

  await fixture.db.pool.query(
    'INSERT INTO users(id,telegram_id,created_at,private_chat_id) VALUES($1,$1,0,$1)',
    [owner],
  );

  await fixture.db.pool.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$1,$1)', [
    device,
    owner,
  ]);

  await fixture.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    owner,
    device,
    id,
    JSON.stringify({
      title: options.title ?? 'Synthetic formatting',
      target: { kind: 'codex-cli' },
      errorCode: options.errorCode,
    }),
  ]);

  for (const [index, data] of [
    { type: 'message', payload: { role: 'assistant', text } },
    { type: 'turn_end', payload: { reason: options.reason ?? 'completed' } },
  ].entries()) {
    await fixture.db.pool.query(
      'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [owner, device, 'synthetic', index + 1, randomUUID(), id, 100 + index, JSON.stringify(data)],
    );
  }

  await fixture.db.pool.query(
    'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$1,$3,200,0)',
    [id, owner, options.kind ?? 'turn_end'],
  );

  const sent: SentMessage[] = [];

  await new NotificationDelivery(
    new NotificationRepository(fixture.db),
    'https://example.invalid/app',
    async (body) => {
      sent.push(body as SentMessage);

      return { ok: true };
    },
  ).deliver(Date.now(), id);

  expect(sent).toHaveLength(1);

  return { body: sent[0]!, owner, id };
}

// Flattening whitespace or forwarding raw Markdown would destroy this payload's visual structure.
it('delivers paragraphs, ordered list items and supported Markdown as Telegram HTML', async () => {
  const { body, owner, id } = await deliver(
    '**Готово**\n\n1. Первый пункт с `кодом`\n2. Второй пункт\n\nПроверки прошли.',
  );

  expect(body.chat_id).toBe(owner);
  expect(body.parse_mode).toBe('HTML');

  expect(body.text).toContain(
    '<b>Готово</b>\n\n1. Первый пункт с <code>кодом</code>\n2. Второй пункт\n\nПроверки прошли.',
  );

  expect(body.text).toContain('Codex replied · Synthetic formatting\n\n');

  expect(body.reply_markup.inline_keyboard[0]![0]!.web_app.url).toBe(
    'https://example.invalid/app#session=' + id,
  );
});

it('escapes untrusted session titles and raw HTML without creating Telegram tags', async () => {
  const { body } = await deliver('<b>Fake</b> & <script>alert(1)</script>\n\n`a < b && c > d`', {
    title: '<a href="tg://user?id=1">owner</a> & **literal**',
  });

  expect(body.text).toContain('&lt;a href="tg://user?id=1"&gt;owner&lt;/a&gt; &amp; **literal**');
  expect(body.text).toContain('&lt;b&gt;Fake&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(body.text).toContain('<code>a &lt; b &amp;&amp; c &gt; d</code>');
  expect(body.text).not.toContain('<script>');
  expect(body.text).not.toContain('<b>Fake</b>');
});

it('preserves fenced code indentation and renders only safe bounded HTTP links', async () => {
  const { body } = await deliver(
    '```ts\nif (a < b) {\n  run("&");\n}\n```\n\n[Docs](https://example.invalid/a?x=1&y=2) [local](file:///Users/private/key) [bad](javascript:alert) [huge](https://example.invalid/' +
      'x'.repeat(5000) +
      ')',
  );

  expect(body.text).toContain('<pre>if (a &lt; b) {\n  run("&amp;");\n}</pre>');
  expect(body.text).toContain('<a href="https://example.invalid/a?x=1&amp;y=2">Docs</a>');
  expect(body.text).toContain('local bad huge');
  expect(body.text).not.toContain('file:');
  expect(body.text).not.toContain('javascript:');
  expect(body.text).not.toContain('x'.repeat(1025));
  expect(body.link_preview_options).toEqual({ is_disabled: true });
});

it('truncates formatted Unicode previews without broken entities, tags or surrogate pairs', async () => {
  const { body } = await deliver('**' + '😀<&'.repeat(3000) + '**', { title: '😀'.repeat(100) });

  expect(body.text).toContain('<b>');
  expect(body.text).toContain('…</b>');
  expect(body.text.length).toBeLessThanOrEqual(4096);
  expect(body.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  expect(body.text.match(/<b>/g)).toHaveLength(1);
  expect(body.text.match(/<\/b>/g)).toHaveLength(1);
  expect(body.text.replace(/&(?:amp|lt|gt|quot);/g, '')).not.toMatch(/&/);
});

it('keeps repeated large links within Telegram bounds and closes every emitted link', async () => {
  const link = '[document](https://example.invalid/' + 'a'.repeat(800) + ')';
  const { body } = await deliver(Array(30).fill(link).join('\n'));

  expect(body.text.length).toBeLessThanOrEqual(4096);
  expect(body.text).toContain('…');
  expect(body.text.match(/<a /g)?.length).toBe(body.text.match(/<\/a>/g)?.length);
});

it.each([
  [{ kind: 'permission' }, 'is waiting for permission'],
  [{ reason: 'interrupted' }, 'was stopped'],
  [{ reason: 'failed' }, 'could not finish the request'],
  [{ errorCode: 'synthetic_failure' }, 'could not finish the request'],
])(
  'keeps action-required notification semantics without exposing an answer: %j',
  async (options, expected) => {
    const { body } = await deliver('DO NOT PREVIEW', { ...options, title: '<b>untrusted</b>' });

    expect(body.text).toContain(expected);
    expect(body.text).toContain('&lt;b&gt;untrusted&lt;/b&gt;');
    expect(body.text).not.toContain('DO NOT PREVIEW');
    expect(body.text).not.toContain('<b>untrusted</b>');
  },
);

it('does not nest code inside style or link entities that Telegram rejects', async () => {
  const { body } = await deliver('**Use `npm test` now** and [the `API` docs](https://example.invalid).');

  expect(body.text).toContain('<code>npm test</code>');
  expect(body.text).toContain('<code>API</code>');
  expect(body.text).toContain('Use <code>npm test</code> now and the <code>API</code> docs.');
});

it('closes a truncated fenced code block and keeps reference links readable', async () => {
  const { body } = await deliver(
    '[Guide][guide]\n\n[guide]: https://example.invalid/reference\n\n```txt\n' +
      '😀 <tag> & value\n'.repeat(1000) +
      '```',
  );

  expect(body.text).toContain('<a href="https://example.invalid/reference">Guide</a>');
  expect(body.text).toContain('<pre>😀 &lt;tag&gt; &amp; value\n');
  expect(body.text).toContain('…</pre>');
  expect(body.text.length).toBeLessThanOrEqual(4096);
  expect(body.text).not.toContain('```');
});
