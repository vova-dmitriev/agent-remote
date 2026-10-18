export const HttpRequestMethod = { Get: 'GET', Post: 'POST' } as const;
export type HttpRequestMethod = (typeof HttpRequestMethod)[keyof typeof HttpRequestMethod];
