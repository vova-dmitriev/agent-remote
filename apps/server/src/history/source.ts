import {
  ErrorCode,
  HistoryDirection,
  EventType,
  FrameType,
  HISTORY_PAGE_MESSAGES,
  HISTORY_CURSOR_MAX_LENGTH,
  type DeviceFrame,
  type EventEnvelope,
  type HistoryMessage,
  type HistoryRead,
  type ServerFrame,
  HttpStatus,
  knownErrorCode,
  SUBAGENT_ID_PATTERN,
} from '@protocol';
import {
  HISTORY_MAX_PENDING_READS_PER_DEVICE,
  HISTORY_SOURCE_TIMEOUT_MS,
  HISTORY_SOURCE_CURSOR_PREFIX,
  HISTORY_POSITION_CURSOR_PREFIX,
} from './limits.js';
import { randomUUID } from 'node:crypto';
import { type WebSocket } from 'ws';
import { type Principal } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type HistoryRepository } from './repository.js';
import { type HistoryPage } from './service.js';

interface Connection {
  socket: WebSocket;
  epoch: string;
  device: { owner_id: string };
}
interface Pending {
  deviceId: string;
  ownerId: string;
  epoch: string;
  sessionId: string;
  generation: string;
  messages: HistoryMessage[];
  at: number;
  aroundId?: string;
  resolve: (page: HistoryPage | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class SourceHistory {
  private pending = new Map<string, Pending>();
  constructor(
    private repository: HistoryRepository,
    private live: Map<string, Connection>,
    private send: (socket: WebSocket, frame: ServerFrame) => boolean,
  ) {}
  async page(
    principal: Pick<Principal, 'userId'>,
    sessionId: string,
    before?: unknown,
    around?: unknown,
    after?: unknown,
    position?: unknown,
    single = false,
    agentId?: unknown,
  ): Promise<HistoryPage | null> {
    if (agentId !== undefined && (typeof agentId !== 'string' || !SUBAGENT_ID_PATTERN.test(agentId))) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    const row = await this.repository.sourceSession(principal.userId, sessionId);

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    const connection = this.live.get(row.device_id);

    // A subagent has no cached history: only its device's transcript reader can answer.
    if (agentId !== undefined) {
      if (!row.data.capabilities?.subagentHistory) {
        throw new Fault(ErrorCode.TRANSCRIPT_UNAVAILABLE, HttpStatus.ServiceUnavailable);
      }

      if (!connection) {
        throw new Fault(ErrorCode.SERVICE_UNAVAILABLE);
      }
    }

    if (!row.data.capabilities?.historyWindow || !connection) {
      if (
        [before, after].some(
          (value) => typeof value === 'string' && value.startsWith(HISTORY_SOURCE_CURSOR_PREFIX),
        )
      ) {
        throw new Fault(ErrorCode.SERVICE_UNAVAILABLE);
      }

      return null;
    }

    if (connection.device.owner_id !== principal.userId) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    if ([before, around, after].filter((value) => value !== undefined).length > 1) {
      throw new Fault(ErrorCode.INVALID_CURSOR);
    }

    if (
      position !== undefined &&
      (typeof position !== 'string' ||
        position.length > HISTORY_CURSOR_MAX_LENGTH ||
        !position.startsWith(HISTORY_POSITION_CURSOR_PREFIX) ||
        !around)
    ) {
      throw new Fault(ErrorCode.INVALID_CURSOR);
    }

    const raw = before ?? around ?? after;

    if (
      raw !== undefined &&
      (typeof raw !== 'string' || !raw.length || raw.length > HISTORY_CURSOR_MAX_LENGTH)
    ) {
      throw new Fault(ErrorCode.INVALID_CURSOR);
    }

    // Legacy cached cursors stay on their original data source.
    if ((before || after) && !(raw as string).startsWith(HISTORY_SOURCE_CURSOR_PREFIX)) {
      if (agentId !== undefined) {
        throw new Fault(ErrorCode.INVALID_CURSOR);
      }

      return null;
    }

    if (
      [...this.pending.values()].filter((value) => value.deviceId === row.device_id).length >=
      HISTORY_MAX_PENDING_READS_PER_DEVICE
    ) {
      throw new Fault(ErrorCode.RATE_LIMITED);
    }

    const requestId = randomUUID();
    let direction: HistoryRead['direction'] = HistoryDirection.Latest;

    if (single) {
      direction = EventType.Message;
    } else if (before) {
      direction = HistoryDirection.Before;
    } else if (after) {
      direction = HistoryDirection.After;
    } else if (around) {
      direction = HistoryDirection.Around;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Fault(ErrorCode.HISTORY_RELOAD_FAILED));
      }, HISTORY_SOURCE_TIMEOUT_MS);

      this.pending.set(requestId, {
        deviceId: row.device_id,
        ownerId: principal.userId,
        epoch: connection.epoch,
        sessionId,
        generation: row.data.generation,
        messages: [],
        at: Date.now(),
        ...(typeof around === 'string' ? { aroundId: around } : {}),
        resolve,
        reject,
        timer,
      });

      const request: HistoryRead = {
        type: FrameType.HistoryRead,
        requestId,
        sessionId,
        generation: row.data.generation,
        direction,
        ...(typeof agentId === 'string' ? { agentId } : {}),
        ...(raw
          ? {
              anchor:
                direction === HistoryDirection.Around || direction === HistoryDirection.Message
                  ? String(position ?? raw)
                  : String(raw).slice(HISTORY_SOURCE_CURSOR_PREFIX.length),
            }
          : {}),
      };

      if (!this.send(connection.socket, request)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Fault(ErrorCode.SERVICE_UNAVAILABLE));
      }
    });
  }
  accept(
    connection: Connection & { device: { id: string; owner_id: string } },
    frame: Extract<DeviceFrame, { type: typeof FrameType.HistoryItem | typeof FrameType.HistoryDone }>,
  ) {
    const pending = this.pending.get(frame.requestId);

    if (
      !pending ||
      pending.deviceId !== connection.device.id ||
      pending.ownerId !== connection.device.owner_id ||
      pending.epoch !== connection.epoch ||
      pending.sessionId !== frame.sessionId ||
      pending.generation !== frame.generation
    ) {
      return;
    }

    if (frame.type === FrameType.HistoryItem) {
      if (pending.messages.length >= HISTORY_PAGE_MESSAGES) {
        return;
      }

      pending.messages.push(frame.message);

      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(frame.requestId);

    if (frame.error) {
      pending.reject(
        new Fault(
          knownErrorCode(new Error(frame.error), ErrorCode.SERVICE_UNAVAILABLE),
          HttpStatus.ServiceUnavailable,
        ),
      );

      return;
    }

    if (pending.aroundId && !pending.messages.some((message) => message.id === pending.aroundId)) {
      pending.resolve(null);

      return;
    }

    const events: EventEnvelope[] = pending.messages.map((message, index) => ({
      version: 1,
      deviceId: pending.deviceId,
      streamId: 'history:' + frame.requestId,
      seq: index + 1,
      eventId: 'history:' + message.id,
      sessionId: pending.sessionId,
      occurredAt: pending.at,
      type: EventType.Message,
      payload: message,
    }));

    pending.resolve({
      events,
      nextCursor: frame.before ? HISTORY_SOURCE_CURSOR_PREFIX + frame.before : null,
      afterCursor: frame.after ? HISTORY_SOURCE_CURSOR_PREFIX + frame.after : null,
    });
  }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Fault(ErrorCode.SERVICE_UNAVAILABLE));
    }

    this.pending.clear();
  }
}
