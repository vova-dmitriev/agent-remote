export const HttpRequestMethod = { Get: 'GET', Post: 'POST', Put: 'PUT' } as const;
export type HttpRequestMethod = (typeof HttpRequestMethod)[keyof typeof HttpRequestMethod];
