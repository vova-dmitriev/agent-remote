import { Language } from '@protocol';

/** Everything the Telegram bot says, per language. `title` is a ready " · Title" suffix or empty. */
export interface NotificationCopy {
  deviceUnavailable: string;
  pairPending: string;
  pairQuota: string;
  pairUnavailable: string;
  openApp: string;
  openSession: string;
  permission: (agent: string, title: string) => string;
  permissionUnknownSession: string;
  finished: (title: string) => string;
  interrupted: (agent: string, title: string) => string;
  failed: (agent: string, title: string) => string;
  answered: (agent: string, title: string, preview: string) => string;
}

export const NOTIFICATION_COPY: Record<Language, NotificationCopy> = {
  [Language.En]: {
    deviceUnavailable: 'Your Mac is unavailable.',
    pairPending: 'Confirm the connection on your Mac, then open Agent Remote with the button below.',
    pairQuota:
      'A Mac is already connected to this account. Use it, or revoke its access in the app before connecting a new one.',
    pairUnavailable: 'This connection link is no longer available. Start connecting again on your Mac.',
    openApp: 'Open Agent Remote',
    openSession: 'Open session',
    permission: (agent, title) =>
      `${agent} is waiting for permission${title}. Open the session to allow or deny the action.`,
    permissionUnknownSession: 'An agent is asking for permission.',
    finished: (title) => `The request finished${title}. Open the session to check the result.`,
    interrupted: (agent, title) => `${agent} was stopped${title}. Open the session to continue.`,
    failed: (agent, title) => `${agent} could not finish the request${title}. Open the session to see why.`,
    answered: (agent, title, preview) => `${agent} replied${title}\n\n${preview}`,
  },
  [Language.Ru]: {
    deviceUnavailable: 'Mac недоступен.',
    pairPending: 'Подтверди подключение на Mac. Затем открой Agent Remote кнопкой ниже.',
    pairQuota:
      'У этого аккаунта уже подключён Mac. Используй его или отзови доступ в приложении перед новым подключением.',
    pairUnavailable: 'Ссылка подключения недоступна. Запусти подключение заново на Mac.',
    openApp: 'Открыть Agent Remote',
    openSession: 'Открыть сессию',
    permission: (agent, title) =>
      `${agent} ждёт разрешения${title}. Открой сессию, чтобы подтвердить или отклонить действие.`,
    permissionUnknownSession: 'Агент запрашивает разрешение.',
    finished: (title) => `Обработка запроса закончилась${title}. Открой сессию, чтобы проверить результат.`,
    interrupted: (agent, title) => `${agent} остановлен${title}. Открой сессию, чтобы продолжить.`,
    failed: (agent, title) =>
      `${agent} не смог завершить запрос${title}. Открой сессию, чтобы посмотреть причину.`,
    answered: (agent, title, preview) => `${agent} ответил${title}\n\n${preview}`,
  },
};

/** The recipient's chosen app language; English when none is set. */
export const notificationCopy = (language: string | null | undefined): NotificationCopy =>
  NOTIFICATION_COPY[language === Language.Ru ? Language.Ru : Language.En];
