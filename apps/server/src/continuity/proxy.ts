import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  FrameType,
  continuityLocalRequestSchema,
  type ContinuityLocalRequest,
  type ContinuityLocalResponse,
  type DeviceFrame,
  type ServerFrame,
} from '@protocol';
import { Fault, type Principal } from '../auth/security.js';
import type { DeviceService } from '../devices/service.js';
import type { ProfileConnection } from '../profiles/types.js';

interface PendingRequest {
  connection: ProfileConnection;
  ownerId: string;
  deviceId: string;
  kind: ContinuityLocalRequest['kind'];
  authorize: () => Promise<void>;
  resolve: (result: ContinuityLocalResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ContinuityProxy {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly devices: Pick<DeviceService, 'owned'>,
    private readonly live: Map<string, ProfileConnection>,
    private readonly send: (socket: ProfileConnection['socket'], frame: ServerFrame) => boolean,
  ) {}

  async request(
    principal: Principal,
    deviceId: string,
    raw: ContinuityLocalRequest,
    authorize: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ContinuityLocalResponse> {
    await authorize();
    const device = await this.devices.owned(principal, deviceId);
    const request = continuityLocalRequestSchema.parse(raw);
    const connection = this.live.get(deviceId);

    await authorize();

    if (
      !connection ||
      connection.device.owner_id !== principal.userId ||
      connection.device.generation !== device.generation ||
      this.live.get(deviceId) !== connection
    ) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE, 409);
    }

    if (signal?.aborted) {
      throw new Fault(ErrorCode.REQUEST_FAILED, 409);
    }

    if (this.pending.size >= 64) {
      throw new Fault(ErrorCode.QUEUE_FULL, 429);
    }

    const requestId = randomUUID();
    const abort = () => this.cancel(requestId, ErrorCode.REQUEST_FAILED);

    const response = new Promise<ContinuityLocalResponse>((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(requestId, ErrorCode.REQUEST_TIMEOUT), 15_000);

      this.pending.set(requestId, {
        connection,
        ownerId: principal.userId,
        deviceId,
        kind: request.kind,
        authorize,
        resolve,
        reject,
        timer,
      });

      signal?.addEventListener('abort', abort, { once: true });

      if (
        !this.send(connection.socket, {
          type: FrameType.ContinuityRequest,
          requestId,
          epoch: connection.epoch,
          request,
        })
      ) {
        this.cancel(requestId, ErrorCode.DEVICE_OFFLINE);
      }
    });

    try {
      const result = await response;

      await authorize();
      await this.devices.owned(principal, deviceId);

      if (this.live.get(deviceId) !== connection) {
        throw new Fault(ErrorCode.STALE_EPOCH, 409);
      }

      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async accept(
    connection: ProfileConnection,
    frame: Extract<DeviceFrame, { type: typeof FrameType.ContinuityResult }>,
  ) {
    const pending = this.pending.get(frame.requestId);

    if (
      !pending ||
      pending.connection !== connection ||
      this.live.get(pending.deviceId) !== connection ||
      frame.epoch !== connection.epoch ||
      connection.device.owner_id !== pending.ownerId
    ) {
      return;
    }

    try {
      await pending.authorize();
      await this.devices.owned({ userId: pending.ownerId, telegramId: '' }, pending.deviceId);

      if (this.pending.get(frame.requestId) !== pending) {
        return;
      }

      if (!frame.reply.ok) {
        throw new Fault(frame.reply.code, 409);
      }

      if (frame.reply.response.kind !== pending.kind) {
        throw new Fault(ErrorCode.INVALID_FRAME, 409);
      }

      this.take(frame.requestId);
      pending.resolve(frame.reply.response);
    } catch (error) {
      this.take(frame.requestId);
      pending.reject(error instanceof Fault ? error : new Fault(ErrorCode.INVALID_FRAME, 409));
    }
  }

  disconnect(connection: ProfileConnection) {
    for (const [id, request] of this.pending) {
      if (request.connection === connection) {
        this.cancel(id, ErrorCode.DEVICE_OFFLINE);
      }
    }
  }

  close() {
    for (const id of this.pending.keys()) {
      this.cancel(id, ErrorCode.SERVICE_UNAVAILABLE);
    }
  }

  private cancel(id: string, code: string) {
    const request = this.pending.get(id);

    if (!request) {
      return;
    }

    this.take(id);
    request.reject(new Fault(code, 409));
  }

  private take(id: string) {
    const request = this.pending.get(id);

    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    this.pending.delete(id);
  }
}
