import { CodedError, ErrorCode } from '@protocol';
import { connect, type Socket } from 'node:net';

export function lineReader(socket: Socket, onFrame: (frame: unknown) => void, maxBytes = 131072) {
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (buffer.length > maxBytes) {
      socket.destroy();

      return;
    }

    let newline: number;

    while ((newline = buffer.indexOf(10)) !== -1) {
      const line = buffer.subarray(0, newline);

      buffer = Buffer.from(buffer.subarray(newline + 1));

      try {
        onFrame(JSON.parse(line.toString('utf8')));
      } catch {
        socket.destroy();

        return;
      }
    }
  });
}

export function writeFrame(socket: Socket, frame: unknown) {
  const data = JSON.stringify(frame) + '\n';

  if (Buffer.byteLength(data) > 131072 || socket.writableLength > 1048576) {
    socket.destroy();
    throw new CodedError(ErrorCode.IPC_QUEUE_FULL);
  }

  socket.write(data);
}

export interface LocalReply {
  type?: string;
  code?: string;
  output?: unknown;
  result?: { connected?: number };
}

/** One request over a local socket; aborting `signal` drops it, which the peer sees as a closed request. */
export function requestLocal(
  path: string,
  frame: unknown,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<LocalReply> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new CodedError(ErrorCode.IPC_TIMEOUT));
    }, timeoutMs);

    let settled = false;

    const done = (error: Error | null, value?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve(value as LocalReply);
      }
    };

    signal?.addEventListener('abort', () => done(new CodedError(ErrorCode.IPC_CLOSED)), { once: true });
    socket.on('connect', () => writeFrame(socket, frame));
    socket.on('error', (error) => done(error));
    socket.on('close', () => done(new CodedError(ErrorCode.IPC_CLOSED)));
    lineReader(socket, (value) => done(null, value));
  });
}
