import type { ZodType } from 'zod';
import { ErrorCode, type HttpRequestMethod } from '../../protocol/src/index.js';
import type { ContinuityExchange } from './continuity-client.types.js';

export class ContinuityClientScope {
  constructor(
    private deviceId: string,
    private exchange: ContinuityExchange,
    private current = () => true,
  ) {}

  protected get base() {
    return `/devices/${encodeURIComponent(this.deviceId)}/continuity`;
  }

  protected assertCurrent(deviceId: string) {
    if (!this.current()) {
      throw new Error(ErrorCode.STALE_EPOCH);
    }

    if (deviceId !== this.deviceId) {
      throw new Error(ErrorCode.ACCESS_DENIED);
    }
  }

  protected async request<T>(
    deviceId: string,
    method: HttpRequestMethod,
    path: string,
    schema: ZodType<T>,
    body?: unknown,
  ) {
    this.assertCurrent(deviceId);
    const response = await this.exchange(method, path, body);

    this.assertCurrent(deviceId);

    return schema.parse(response);
  }
}
