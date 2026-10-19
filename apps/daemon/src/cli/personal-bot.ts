import { DaemonErrorCode } from '../error-codes.js';
import { SharedPrivateErrorCode } from '@protocol/private';
import { TelegramButtonType } from '../domain/cli.js';
import { Language } from '@protocol';

export function personalBot(token: string, fetcher: typeof fetch = fetch) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error(DaemonErrorCode.INVALID_BOT_TOKEN);
  }

  async function api<T>(method: string, body: unknown): Promise<T> {
    try {
      const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const value = (await response.json()) as { ok: boolean; result?: T };

      if (!response.ok || !value.ok) {
        throw new Error(DaemonErrorCode.API_REJECTED);
      }

      return value.result!;
    } catch {
      throw new Error(DaemonErrorCode.TELEGRAM_UNAVAILABLE);
    }
  }

  return {
    async check() {
      const me = await api<{ username: string }>('getMe', {});
      const webhook = await api<{ url: string }>('getWebhookInfo', {});

      if (webhook.url) {
        throw new Error(DaemonErrorCode.BOT_HAS_WEBHOOK);
      }

      if (!/^[A-Za-z0-9_]+$/.test(me.username)) {
        throw new Error(DaemonErrorCode.INVALID_BOT_IDENTITY);
      }

      return me.username;
    },
    async setMenu(origin: string) {
      const url = new URL(origin);

      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(SharedPrivateErrorCode.HTTPS_REQUIRED);
      }

      await api('setChatMenuButton', {
        menu_button: {
          type: TelegramButtonType.WebApp,
          text: 'Открыть Agent Remote',
          web_app: { url: url.origin },
        },
      });
    },
    async setName() {
      for (const language_code of ['', Language.Ru, Language.En]) {
        const current = await api<{ name: string }>('getMyName', { language_code });

        if (current.name !== 'Agent Remote') {
          await api('setMyName', { name: 'Agent Remote', language_code });
        }
      }
    },
  };
}
