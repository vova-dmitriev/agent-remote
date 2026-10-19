import type { HttpRequestMethod } from '@protocol';

export type ContinuityExchange = (
  method: HttpRequestMethod,
  path: string,
  body?: unknown,
) => Promise<unknown>;
