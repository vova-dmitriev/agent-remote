import { randomUUID } from 'node:crypto';
import {
  type AnalyticsPeriod,
  type AnalyticsReport,
  type RulesReply,
  type RulesRequest,
  type DeviceFrame,
  ErrorCode,
  FrameType,
  type ModelChoice,
  type ProjectSession,
  type ServerFrame,
  type SessionFile,
} from '@protocol';
import { Fault } from '../http/errors/fault.js';
import type { WebSocket } from 'ws';

export type DeviceResult = Extract<
  DeviceFrame,
  {
    type:
      | typeof FrameType.FileResult
      | typeof FrameType.AnalyticsResult
      | typeof FrameType.RulesResult
      | typeof FrameType.SessionModelResult
      | typeof FrameType.SessionCreateResult;
  }
>;

/** The part of a live device connection a request uses. */
interface DeviceConnection {
  socket: WebSocket;
}

interface PendingRequest {
  connection: DeviceConnection;
  answer: DeviceResult['type'];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PENDING = 64;

/** Asks the device that runs a session for something only the Mac has: a changed file, the usage report, a switch. */
export class DeviceRequests {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly send: (socket: DeviceConnection['socket'], frame: ServerFrame) => boolean) {}

  read(connection: DeviceConnection, sessionId: string, path: string) {
    return this.request<SessionFile>(connection, FrameType.FileResult, (requestId) => ({
      type: FrameType.FileRequest,
      requestId,
      sessionId,
      path,
    }));
  }

  analytics(connection: DeviceConnection, period: AnalyticsPeriod) {
    return this.request<AnalyticsReport>(connection, FrameType.AnalyticsResult, (requestId) => ({
      type: FrameType.AnalyticsRequest,
      requestId,
      period,
    }));
  }

  rules(connection: DeviceConnection, request: RulesRequest) {
    return this.request<RulesReply>(connection, FrameType.RulesResult, (requestId) => ({
      type: FrameType.RulesRequest,
      requestId,
      request,
    }));
  }

  switchModel(connection: DeviceConnection, sessionId: string, choice: ModelChoice) {
    return this.request<ModelChoice>(connection, FrameType.SessionModelResult, (requestId) => ({
      type: FrameType.SessionModel,
      requestId,
      sessionId,
      choice,
    }));
  }

  createSession(connection: DeviceConnection, session: ProjectSession) {
    return this.request<string>(connection, FrameType.SessionCreateResult, (requestId) => ({
      type: FrameType.SessionCreate,
      requestId,
      session,
    }));
  }

  private request<T>(
    connection: DeviceConnection,
    answer: DeviceResult['type'],
    frame: (requestId: string) => ServerFrame,
  ): Promise<T> {
    if (this.pending.size >= MAX_PENDING) {
      throw new Fault(ErrorCode.QUEUE_FULL);
    }

    const requestId = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(requestId, ErrorCode.REQUEST_TIMEOUT), REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, {
        connection,
        answer,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      if (!this.send(connection.socket, frame(requestId))) {
        this.settle(requestId, ErrorCode.DEVICE_OFFLINE);
      }
    });
  }

  /** A device's answer; only the connection that was asked can answer, and only with the kind it was asked for. */
  accept(connection: DeviceConnection, frame: DeviceResult) {
    const pending = this.pending.get(frame.requestId);

    if (!pending || pending.connection !== connection || pending.answer !== frame.type) {
      return;
    }

    if (!frame.reply.ok) {
      this.settle(frame.requestId, frame.reply.code);

      return;
    }

    this.take(frame.requestId);
    const { reply } = frame;

    if ('file' in reply) {
      pending.resolve(reply.file);
    } else if ('report' in reply) {
      pending.resolve(reply.report);
    } else if ('choice' in reply) {
      pending.resolve(reply.choice);
    } else if ('sessionId' in reply) {
      pending.resolve(reply.sessionId);
    } else {
      pending.resolve(reply.rules);
    }
  }

  disconnect(connection: DeviceConnection) {
    for (const [id, request] of this.pending) {
      if (request.connection === connection) {
        this.settle(id, ErrorCode.DEVICE_OFFLINE);
      }
    }
  }

  close() {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, ErrorCode.SERVICE_UNAVAILABLE);
    }
  }

  private settle(id: string, code: ErrorCode) {
    this.take(id)?.reject(new Fault(code));
  }

  private take(id: string) {
    const request = this.pending.get(id);

    if (request) {
      clearTimeout(request.timer);
      this.pending.delete(id);
    }

    return request;
  }
}
