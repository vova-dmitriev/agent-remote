import { createHmac } from 'node:crypto';

export const testBotToken = '100000:local-test-token-never-used-with-telegram';

export function initData(telegramId: string, now = Date.now(), extras: Record<string, string> = {}) {
  const data = new URLSearchParams({
    auth_date: String(Math.floor(now / 1000)),
    query_id: 'test',
    user: JSON.stringify({ id: Number(telegramId), first_name: 'Test' }),
    ...extras,
  });

  const secret = createHmac('sha256', 'WebAppData').update(testBotToken).digest();

  const check = [...data]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));

  return data.toString();
}
