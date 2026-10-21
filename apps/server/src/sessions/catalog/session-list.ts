import {
  ErrorCode,
  FrameType,
  RelayProtocolFeature,
  type DeviceFrame,
  type ProviderFilterValue as Provider,
  type ServerFrame,
  type Session,
} from '@protocol';
import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy } from '@nestjs/common';
import { Fault } from '../../http/errors/fault.js';
import type { Principal } from '../../auth/security.js';
import type { RelayHub, DeviceConnection } from '../../realtime/relay-hub.js';
import { SessionCatalogRepository } from './session-catalog-repository.js';
import { SessionRepository } from '../repository.js';
import { SessionLabels } from '../labels.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING = 64;

interface Pending {
  connection: DeviceConnection;
  resolve: (page: { sessions: Session[]; nextCursor: string | null }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A page request is bound to its authenticated owner, paired device generation and provider. */
export class SessionListSource implements OnModuleDestroy {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly sessions: SessionRepository,
    private readonly catalog: SessionCatalogRepository,
    private readonly hub: RelayHub,
    private readonly labels: SessionLabels,
  ) {}

  async page(principal: Principal, deviceId: string, provider: Provider, cursorValue?: string) {
    const ownerId = principal.userId;
    const device = await this.sessions.activeDevice(ownerId, deviceId);
    const connection = this.hub.live.get(deviceId);

    if (
      !device ||
      !connection ||
      connection.device.owner_id !== ownerId ||
      connection.device.generation !== device.generation
    ) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE);
    }

    if (connection.protocolVersion < RelayProtocolFeature.SessionPages) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const deviceCursor = decodeCursor(cursorValue, ownerId, deviceId, device.generation, provider);
    const page = await this.request(connection, provider, deviceCursor);
    const current = await this.sessions.activeDevice(ownerId, deviceId);

    if (this.hub.live.get(deviceId) !== connection || current?.generation !== device.generation) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    const labeled = await this.labels.apply(principal, deviceId, page.sessions);
    const titles = new Map(labeled.map((session) => [session.id, session.title]));

    const ordered = page.sessions.map((session) => {
      const title = titles.get(session.id);

      return title ? { ...session, title } : session;
    });

    await this.catalog.savePage(ownerId, deviceId, ordered);
    const savedDevice = await this.sessions.activeDevice(ownerId, deviceId);

    if (
      this.hub.live.get(deviceId) !== connection ||
      !savedDevice ||
      savedDevice.generation !== device.generation
    ) {
      throw new Fault(ErrorCode.STALE_SESSION);
    }

    return {
      sessions: ordered,
      nextCursor: page.nextCursor
        ? encodeCursor({
            ownerId,
            deviceId,
            generation: device.generation,
            provider,
            cursor: page.nextCursor,
          })
        : null,
    };
  }

  private request(connection: DeviceConnection, provider: Provider, cursor?: string) {
    if (this.pending.size >= MAX_PENDING) {
      throw new Fault(ErrorCode.QUEUE_FULL);
    }

    const requestId = randomUUID();

    return new Promise<{ sessions: Session[]; nextCursor: string | null }>((resolve, reject) => {
      const timer = setTimeout(() => this.settle(requestId, ErrorCode.REQUEST_TIMEOUT), REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, { connection, resolve, reject, timer });

      const frame: ServerFrame = {
        type: FrameType.SessionListRead,
        requestId,
        provider,
        ...(cursor ? { cursor } : {}),
      };

      if (!this.hub.send(connection.socket, frame)) {
        this.settle(requestId, ErrorCode.DEVICE_OFFLINE);
      }
    });
  }

  accept(
    connection: DeviceConnection,
    frame: Extract<DeviceFrame, { type: typeof FrameType.SessionListResult }>,
  ) {
    const pending = this.pending.get(frame.requestId);

    if (!pending || pending.connection !== connection || !frame.reply.ok) {
      if (pending && pending.connection === connection && !frame.reply.ok) {
        this.settle(frame.requestId, frame.reply.code);
      }

      return;
    }

    this.take(frame.requestId)?.resolve(frame.reply.page);
  }

  disconnect(connection: DeviceConnection) {
    for (const [id, pending] of this.pending) {
      if (pending.connection === connection) {
        this.settle(id, ErrorCode.DEVICE_OFFLINE);
      }
    }
  }

  close() {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, ErrorCode.SERVICE_UNAVAILABLE);
    }
  }

  onModuleDestroy() {
    this.close();
  }

  private settle(id: string, code: ErrorCode) {
    this.take(id)?.reject(new Fault(code));
  }

  private take(id: string) {
    const pending = this.pending.get(id);

    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }

    return pending;
  }
}
