import { Language, ReadyRule, RemotePermissionDecision } from '@protocol';

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
  rateLimitHigh: (agent: string, window: string, percent: number, resetIn: string) => string;
  rateLimitReset: (agent: string, window: string) => string;
  /** A plan window by its length in minutes: "5-hour", "7-day". */
  limitWindow: (minutes: number) => string;
  /** A span of time to the minute: "3 h 52 min", "2 d 4 h". */
  duration: (milliseconds: number) => string;
  /** `rule` and `title` are already escaped; `command` is HTML. */
  rulePermission: (agent: string, rule: string, title: string, command: string) => string;
  readyRules: Record<ReadyRule, string>;
  allowOnce: string;
  allowAlways: string;
  deny: string;
  /** The toast a pressed answer button shows. */
  decided: Record<RemotePermissionDecision, string>;
  decisionClosed: string;
}

const MINUTES_PER_DAY = 1440;

/** Whole days, hours and minutes of a span, rounded to the minute. */
function parts(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);

  return {
    days: Math.floor(minutes / MINUTES_PER_DAY),
    hours: Math.floor(minutes / 60) % 24,
    minutes: minutes % 60,
  };
}

function span(milliseconds: number, day: string, hour: string, minute: string) {
  const { days, hours, minutes } = parts(milliseconds);

  if (days) {
    return `${days} ${day} ${hours} ${hour}`;
  }

  return hours ? `${hours} ${hour} ${minutes} ${minute}` : `${minutes} ${minute}`;
}

const windowLength = (minutes: number, hours: (count: number) => string, days: (count: number) => string) =>
  minutes % MINUTES_PER_DAY === 0 ? days(minutes / MINUTES_PER_DAY) : hours(Math.round(minutes / 60));

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
    rateLimitHigh: (agent, window, percent, resetIn) =>
      `${agent}: ${percent}% of the ${window} window used. Resets in ${resetIn}.`,
    rateLimitReset: (agent, window) =>
      `${agent}: the ${window} window has reset; the limit is available again.`,
    limitWindow: (minutes) =>
      windowLength(
        minutes,
        (count) => `${count}-hour`,
        (count) => `${count}-day`,
      ),
    duration: (milliseconds) => span(milliseconds, 'd', 'h', 'min'),
    rulePermission: (agent, rule, title, command) =>
      `❗ ${agent} wants to run a command your rule «${rule}» covers${title}\n\n<code>${command}</code>`,
    readyRules: {
      [ReadyRule.Database]: 'Suspicious database queries',
      [ReadyRule.RemoveOutsideProject]: 'rm -rf outside the project',
      [ReadyRule.ForcePush]: 'git push --force',
      [ReadyRule.DeployMigrations]: 'Deploys and migrations',
      [ReadyRule.Secrets]: 'Changes to .env and secrets',
    },
    allowOnce: 'Allow once',
    allowAlways: 'Always allow',
    deny: 'Deny',
    decided: {
      [RemotePermissionDecision.Allow]: 'Allowed once.',
      [RemotePermissionDecision.AllowAlways]: 'Allowed; this command will not ask again.',
      [RemotePermissionDecision.Deny]: 'Denied.',
    },
    decisionClosed: 'This request is not yours or is already closed.',
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
    rateLimitHigh: (agent, window, percent, resetIn) =>
      `${agent}: использовано ${percent}% окна ${window}. Сброс через ${resetIn}.`,
    rateLimitReset: (agent, window) => `${agent}: окно ${window} сброшено, лимит снова доступен.`,
    limitWindow: (minutes) =>
      windowLength(
        minutes,
        (count) => `${count} ч`,
        (count) => `${count} дн.`,
      ),
    duration: (milliseconds) => span(milliseconds, 'дн.', 'ч', 'мин'),
    rulePermission: (agent, rule, title, command) =>
      `❗ ${agent} хочет выполнить команду по правилу «${rule}»${title}\n\n<code>${command}</code>`,
    readyRules: {
      [ReadyRule.Database]: 'Опасные запросы к БД',
      [ReadyRule.RemoveOutsideProject]: 'rm -rf вне проекта',
      [ReadyRule.ForcePush]: 'git push --force',
      [ReadyRule.DeployMigrations]: 'Деплой и миграции',
      [ReadyRule.Secrets]: 'Изменение .env и секретов',
    },
    allowOnce: 'Разрешить один раз',
    allowAlways: 'Разрешать всегда',
    deny: 'Отказать',
    decided: {
      [RemotePermissionDecision.Allow]: 'Разрешено один раз.',
      [RemotePermissionDecision.AllowAlways]: 'Разрешено; эта команда больше не будет спрашивать.',
      [RemotePermissionDecision.Deny]: 'Отказано.',
    },
    decisionClosed: 'Этот запрос не ваш или уже закрыт.',
  },
};

/** The recipient's chosen app language; English when none is set. */
export const notificationCopy = (language: string | null | undefined): NotificationCopy =>
  NOTIFICATION_COPY[language === Language.Ru ? Language.Ru : Language.En];
