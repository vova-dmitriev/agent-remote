export const RedisConnectionStatus = {
  Ready: 'ready',
} as const;

export type RedisConnectionStatus = (typeof RedisConnectionStatus)[keyof typeof RedisConnectionStatus];

export const NotificationJobState = {
  Failed: 'failed',
  Completed: 'completed',
} as const;

export type NotificationJobState = (typeof NotificationJobState)[keyof typeof NotificationJobState];

export const NotificationBackoffType = { Exponential: 'exponential' } as const;
export type NotificationBackoffType = (typeof NotificationBackoffType)[keyof typeof NotificationBackoffType];

export const HealthStatus = {
  Ok: 'ok',
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];
