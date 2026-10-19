import type { HttpRequestMethod } from '../../protocol/src/index.js';

export type ContinuityExchange = (
  method: HttpRequestMethod,
  path: string,
  body?: unknown,
) => Promise<unknown>;
