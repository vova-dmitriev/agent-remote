export const HttpMethod = {
  Get: 'get',
  Post: 'post',
  Delete: 'delete',
  Patch: 'patch',
  Put: 'put',
} as const;

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HealthStatus = {
  Ok: 'ok',
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];
