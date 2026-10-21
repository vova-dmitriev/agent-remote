export const NotificationKind = {
  PairPending: 'pair_pending',
  PairQuota: 'pair_quota',
  PairUnavailable: 'pair_unavailable',
  /** A plan window passed a usage threshold. */
  RateLimit: 'rate_limit',
  /** A window that passed a threshold has reset. */
  RateLimitReset: 'rate_limit_reset',
} as const;

export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const NotificationTurnReason = {
  Interrupted: 'interrupted',
  Failed: 'failed',
} as const;

export type NotificationTurnReason = (typeof NotificationTurnReason)[keyof typeof NotificationTurnReason];

export const TelegramUpdateType = { Message: 'message', CallbackQuery: 'callback_query' } as const;
export type TelegramUpdateType = (typeof TelegramUpdateType)[keyof typeof TelegramUpdateType];
export const TelegramChatType = { Private: 'private' } as const;
export type TelegramChatType = (typeof TelegramChatType)[keyof typeof TelegramChatType];
