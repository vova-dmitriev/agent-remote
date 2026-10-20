import { it, expect } from 'vitest';
import { HttpStatus } from '@protocol';
import { mkdtemp, writeFile, readFile, stat, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensurePersonalEnv, startQuickTunnel } from '@daemon/cli/personal/personal-runtime.js';
import { personalBot } from '@daemon/cli/personal/personal-bot.js';

it('creates private local settings and preserves an existing bot token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-env-'));

  try {
    const path = join(dir, '.env');

    await writeFile(path, 'BOT_TOKEN=123456:keep_this_token\nOTHER_SETTING=keep\n');
    const config = await ensurePersonalEnv(path);

    expect(config.botToken).toBe('123456:keep_this_token');
    expect(config.databaseUrl).toContain('127.0.0.1:55433/claude_remote_personal');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toContain('OTHER_SETTING=keep');
    const again = await ensurePersonalEnv(path);

    expect(again.postgresPassword).toBe(config.postgresPassword);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('generates a private Redis password and preserves it across personal launches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-redis-'));

  try {
    const path = join(dir, '.env');
    const first = await ensurePersonalEnv(path);
    const second = await ensurePersonalEnv(path);

    expect(first.redisUrl).toMatch(/^redis:\/\/:[a-f0-9]{64}@127\.0\.0\.1:56379\/0$/);
    expect(second.redisUrl).toBe(first.redisUrl);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('extracts only the assigned HTTPS tunnel URL and stops its own child', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-tunnel-'));

  try {
    const executable = join(dir, 'cloudflared');

    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stderr.write('starting https://noise.example/path\\n');setTimeout(()=>process.stderr.write('https://personal-fixture.trycloudflare.com\\n'),10);setInterval(()=>{},1000);`,
    );

    await chmod(executable, 0o700);
    const tunnel = await startQuickTunnel(3040, { executable, timeoutMs: 5000 });

    try {
      expect(tunnel.origin).toBe('https://personal-fixture.trycloudflare.com');
    } finally {
      await tunnel.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('updates the bot menu to the current HTTPS origin only after checking webhook ownership', async () => {
  const requests: Array<{ method: string; body: unknown }> = [];

  const fetcher: typeof fetch = async (input, init) => {
    const method = String(input).split('/').at(-1)!;

    requests.push({ method, body: JSON.parse(String(init?.body)) });

    const resultForMethod = () => {
      if (method === 'getMe') {
        return { id: 123, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' };
      }

      if (method === 'getWebhookInfo') {
        return { url: '', has_custom_certificate: false, pending_update_count: 0 };
      }

      return true;
    };

    const result = resultForMethod();

    return Response.json({ ok: true, result });
  };

  const bot = personalBot('123456:fixture_token', fetcher);

  expect(await bot.check()).toBe('fixture_bot');
  await bot.setMenu('https://current-fixture.trycloudflare.com');

  expect(requests).toEqual([
    { method: 'getMe', body: {} },
    { method: 'getWebhookInfo', body: {} },
    {
      method: 'setChatMenuButton',
      body: {
        menu_button: {
          type: 'web_app',
          text: 'Открыть Agent Remote',
          web_app: { url: 'https://current-fixture.trycloudflare.com' },
        },
      },
    },
  ]);
});

it('refuses to replace an existing webhook and never exposes the bot token in errors', async () => {
  const methods: string[] = [];

  const bot = personalBot('123456:private_fixture', async (input) => {
    const method = String(input).split('/').at(-1)!;

    methods.push(method);

    return Response.json({
      ok: true,
      result: method === 'getMe' ? { username: 'fixture_bot' } : { url: 'https://existing.example/hook' },
    });
  });

  await expect(bot.check()).rejects.toThrow('BOT_HAS_WEBHOOK');
  expect(methods).toEqual(['getMe', 'getWebhookInfo']);

  const failing = personalBot('123456:private_fixture', async () => {
    throw new Error('https://api.telegram.org/bot123456:private_fixture/getMe');
  });

  await expect(failing.check()).rejects.toThrow(/^TELEGRAM_UNAVAILABLE$/);
});

it('renames the bot for default, Russian and English users without changing its username', async () => {
  const requests: Array<{ method: string; body: unknown }> = [];

  const bot = personalBot('123456:fixture_token', async (input, init) => {
    requests.push({ method: String(input).split('/').at(-1)!, body: JSON.parse(String(init?.body)) });

    return Response.json({ ok: true, result: true });
  });

  await bot.setName();

  expect(requests).toEqual([
    { method: 'getMyName', body: { language_code: '' } },
    { method: 'setMyName', body: { name: 'Agent Remote', language_code: '' } },
    { method: 'getMyName', body: { language_code: 'ru' } },
    { method: 'setMyName', body: { name: 'Agent Remote', language_code: 'ru' } },
    { method: 'getMyName', body: { language_code: 'en' } },
    { method: 'setMyName', body: { name: 'Agent Remote', language_code: 'en' } },
  ]);
});

it('does not rename an already named bot when Telegram rate limits name writes', async () => {
  const methods: string[] = [];

  const bot = personalBot('123456:fixture_token', async (input) => {
    const method = String(input).split('/').at(-1)!;

    methods.push(method);

    return method === 'getMyName'
      ? Response.json({ ok: true, result: { name: 'Agent Remote' } })
      : Response.json({ ok: false, error_code: 429 }, { status: HttpStatus.TooManyRequests });
  });

  await expect(bot.setName()).resolves.toBeUndefined();
  expect(methods).toEqual(['getMyName', 'getMyName', 'getMyName']);
});
