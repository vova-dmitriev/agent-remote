import { CodedError, ErrorCode } from '@protocol';
import { connect } from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { WebSocket } from 'ws';
import { CodexRpcClient, MAX_CODEX_FRAME_BYTES } from './rpc-client.js';

/** Whether a path is this user's own, in a directory of this user's that nobody else can write. */
async function privatePath(path: string, socket: boolean) {
  const [entry, directory] = await Promise.all([lstat(path), lstat(dirname(path))]);

  return (
    (socket ? entry.isSocket() : entry.isSymbolicLink()) &&
    entry.uid === process.getuid?.() &&
    directory.isDirectory() &&
    directory.uid === process.getuid?.() &&
    (directory.mode & 0o022) === 0
  );
}

/**
 * Checks that a path is this user's private socket and returns the socket to connect to. Codex 0.163 listens in a
 * private directory under /tmp and links the requested path to it: a link of this user's, in a private directory, is
 * followed once, and its target is checked like any socket.
 */
export async function verifyLocalSocket(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new CodedError(ErrorCode.CODEX_INVALID_SOCKET);
  }

  const target =
    (await lstat(path)).isSymbolicLink() && (await privatePath(path, false)) ? await realpath(path) : path;

  if (!(await privatePath(target, true))) {
    throw new CodedError(ErrorCode.CODEX_INVALID_SOCKET);
  }

  return target;
}

/** Codex Unix listeners require an HTTP Upgrade without compression extensions. */
export async function connectCodexSocket(path: string) {
  const target = await verifyLocalSocket(path);

  const socket = new WebSocket('ws://localhost/', {
    createConnection: () => connect(target),
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
      socket.once('error', () => reject(new CodedError(ErrorCode.CODEX_DISCONNECTED)));
    });

    await client.initialize();

    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
