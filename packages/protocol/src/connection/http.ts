export const HttpRequestMethod = { Get: 'GET', Post: 'POST', Put: 'PUT' } as const;
export type HttpRequestMethod = (typeof HttpRequestMethod)[keyof typeof HttpRequestMethod];

export const HttpStatus = {
  Ok: 200,
  NoContent: 204,
  MultipleChoices: 300,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  PayloadTooLarge: 413,
  TooManyRequests: 429,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];
