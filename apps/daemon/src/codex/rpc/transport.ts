import { ErrorCode } from '@protocol';
import { connect } from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { WebSocket } from 'ws';
import { CodexRpcClient, MAX_CODEX_FRAME_BYTES } from './rpc-client.js';

export async function verifyLocalSocket(path: string) {
  if (!isAbsolute(path)) {
    throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
  }

  const [socket, directory] = await Promise.all([lstat(path), lstat(dirname(path))]);

  if (
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    socket.uid !== process.getuid?.() ||
    !directory.isDirectory() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o022) !== 0
  ) {
    throw new Error(ErrorCode.CODEX_INVALID_SOCKET);
  }
}

/** Codex Unix listeners require an HTTP Upgrade without compression extensions. */
export async function connectCodexSocket(path: string) {
  await verifyLocalSocket(path);

  const socket = new WebSocket('ws://localhost/', {
    createConnection: () => connect(path),
    perMessageDeflate: false,
    handshakeTimeout: 5000,
    maxPayload: MAX_CODEX_FRAME_BYTES,
  });

  const output = new PassThrough();

  const input = new Writable({
    write(chunk, _encoding, callback) {
      socket.send(String(chunk).trimEnd(), callback);
    },
  });

  const client = new CodexRpcClient({
    input,
    output,
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => socket.terminate(), 500);

        socket.once('close', () => {
          clearTimeout(timer);
          resolve();
        });

        socket.close();
      });
    },
  });

  socket.on('message', (frame) => output.write(String(frame) + '\n'));
  socket.once('error', () => client.disconnect());
  socket.once('close', () => client.disconnect());

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', () => reject(new Error(ErrorCode.CODEX_DISCONNECTED)));
    });

    await client.initialize();

    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
