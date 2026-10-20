import { randomUUID } from 'node:crypto';
import { type DeviceFrame, ErrorCode, FrameType, type ServerFrame, type SessionFile } from '@protocol';
import { Fault } from '../http/errors/fault.js';
import type { WebSocket } from 'ws';

type FileResult = Extract<DeviceFrame, { type: typeof FrameType.FileResult }>;

/** The part of a live device connection a file read uses. */
interface DeviceConnection {
  socket: WebSocket;
}

interface PendingFile {
  connection: DeviceConnection;
  resolve: (file: SessionFile) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const FILE_TIMEOUT_MS = 15_000;
const MAX_PENDING = 64;

/** Reads a file a session changed from the device that runs the session, for the app's file view. */
export class SessionFiles {
  private readonly pending = new Map<string, PendingFile>();

  constructor(private readonly send: (socket: DeviceConnection['socket'], frame: ServerFrame) => boolean) {}

  read(connection: DeviceConnection, sessionId: string, path: string): Promise<SessionFile> {
    if (this.pending.size >= MAX_PENDING) {
      throw new Fault(ErrorCode.QUEUE_FULL);
    }

    const requestId = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(requestId, ErrorCode.REQUEST_TIMEOUT), FILE_TIMEOUT_MS);

      this.pending.set(requestId, { connection, resolve, reject, timer });

      if (!this.send(connection.socket, { type: FrameType.FileRequest, requestId, sessionId, path })) {
        this.settle(requestId, ErrorCode.DEVICE_OFFLINE);
      }
    });
  }

  /** A device's answer; only the connection that was asked can answer. */
  accept(connection: DeviceConnection, frame: FileResult) {
    const pending = this.pending.get(frame.requestId);

    if (!pending || pending.connection !== connection) {
      return;
    }

    if (frame.reply.ok) {
      this.take(frame.requestId);
      pending.resolve(frame.reply.file);
    } else {
      this.settle(frame.requestId, frame.reply.code);
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
