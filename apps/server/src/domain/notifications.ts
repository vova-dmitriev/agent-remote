export const NotificationKind = {
  PairPending: 'pair_pending',
  PairQuota: 'pair_quota',
  PairUnavailable: 'pair_unavailable',
} as const;

export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const NotificationTurnReason = {
  Interrupted: 'interrupted',
  Failed: 'failed',
} as const;

export type NotificationTurnReason = (typeof NotificationTurnReason)[keyof typeof NotificationTurnReason];

export const TelegramUpdateType = { Message: 'message' } as const;
export type TelegramUpdateType = (typeof TelegramUpdateType)[keyof typeof TelegramUpdateType];
export const TelegramChatType = { Private: 'private' } as const;
export type TelegramChatType = (typeof TelegramChatType)[keyof typeof TelegramChatType];
