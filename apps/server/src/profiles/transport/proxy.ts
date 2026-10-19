import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  FrameType,
  profileReplySchema,
  profileRequestSchema,
  type ProfileRequest,
  type ProfileResponse,
  type ServerFrame,
  type DeviceFrame,
  HttpStatus,
} from '@protocol';
import { type Principal } from '../../auth/security.js';
import { Fault } from '../../http/errors/fault.js';
import type { DeviceService } from '../../devices/service.js';
import { ProfileProxyLimit } from '../values.js';
import { ProfileRequestRegistry } from './pending.js';
import type { ProfileConnection } from '../types.js';

export class ProfileProxy {
  private pending: ProfileRequestRegistry;

  constructor(
    private devices: Pick<DeviceService, 'owned'>,
    private live: Map<string, ProfileConnection>,
    private send: (connection: ProfileConnection['socket'], frame: ServerFrame) => boolean,
  ) {
    this.pending = new ProfileRequestRegistry(live, send);
  }

  async request(
    principal: Principal,
    deviceId: string,
    raw: ProfileRequest,
    authKey: string,
    authorize: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ProfileResponse> {
    await authorize();
    const device = await this.devices.owned(principal, deviceId);
    const request = profileRequestSchema.parse(raw);
    const connection = this.live.get(deviceId);

    await authorize();

    if (
      !connection ||
      this.live.get(deviceId) !== connection ||
      connection.device.owner_id !== principal.userId ||
      connection.device.generation !== device.generation
    ) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (signal?.aborted) {
      throw new Fault(ErrorCode.REQUEST_FAILED);
    }

    if (
      this.pending.size >= ProfileProxyLimit.Total ||
      [...this.pending.values()].filter((item) => item.deviceId === deviceId).length >=
        ProfileProxyLimit.PerDevice
    ) {
      throw new Fault(ErrorCode.QUEUE_FULL);
    }

    const requestId = randomUUID();
    const abort = () => this.pending.cancel(requestId, ErrorCode.REQUEST_FAILED);

    const result = new Promise<ProfileResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => this.pending.cancel(requestId, ErrorCode.REQUEST_TIMEOUT),
        ProfileProxyLimit.TimeoutMs,
      );

      this.pending.set(requestId, {
        connection,
        authKey,
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
          type: FrameType.ProfilesRequest,
          requestId,
          epoch: connection.epoch,
          request,
        })
      ) {
        this.pending.cancel(requestId, ErrorCode.DEVICE_OFFLINE);
      }
    });

    try {
      const response = await result;

      await authorize();
      await this.devices.owned(principal, deviceId);
      await authorize();

      if (this.live.get(deviceId) !== connection) {
        throw new Fault(ErrorCode.STALE_EPOCH);
      }

      return response;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async accept(
    connection: ProfileConnection,
    frame: Extract<DeviceFrame, { type: typeof FrameType.ProfilesResult }>,
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
      await pending.authorize();

      if (this.pending.get(frame.requestId) !== pending || this.live.get(pending.deviceId) !== connection) {
        return;
      }

      const reply = profileReplySchema.parse(frame.reply);

      if (!reply.ok) {
        throw new Fault(reply.code, HttpStatus.Conflict);
      }

      if (reply.response.kind !== pending.kind) {
        throw new Fault(ErrorCode.INVALID_FRAME);
      }

      this.pending.take(frame.requestId);
      pending.resolve(reply.response);
    } catch (error) {
      this.pending.take(frame.requestId);
      pending.reject(error instanceof Fault ? error : new Fault(ErrorCode.INVALID_FRAME));
    }
  }

  cancelAuth(keys: readonly string[]) {
    this.pending.cancelAuth(keys);
  }

  disconnect(connection: ProfileConnection) {
    this.pending.disconnect(connection);
  }

  close() {
    this.pending.close();
  }
}
