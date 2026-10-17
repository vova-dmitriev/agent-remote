interface Socket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(payload: string, callback: (error?: Error) => void): void;
  close(code: number, reason?: string): void;
}
/** Node WebSocket writer: no unbounded user-space backlog for slow peers. */
export class BoundedSender {
  private pending = new WeakMap<Socket, { frames: number; bytes: number }>();
  send(socket: Socket, frame: object): boolean {
    if (socket.readyState !== 1) {
      return false;
    }

    const payload = JSON.stringify(frame),
      bytes = Buffer.byteLength(payload);

    const pending = this.pending.get(socket) ?? { frames: 0, bytes: 0 };

    if (
      bytes > 131072 ||
      pending.frames >= 256 ||
      Math.max(pending.bytes, socket.bufferedAmount) + bytes > 1048576
    ) {
      socket.close(1013, 'QUEUE_FULL');

      return false;
    }

    pending.frames++;
    pending.bytes += bytes;
    this.pending.set(socket, pending);
    let settled = false;

    const complete = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      pending.frames--;
      pending.bytes -= bytes;

      if (!pending.frames) {
        this.pending.delete(socket);
      }

      if (error && socket.readyState === 1) {
        socket.close(1013, 'WRITE_FAILED');
      }
    };

    try {
      socket.send(payload, complete);

      return true;
    } catch {
      complete(new Error('WRITE_FAILED'));

      return false;
    }
  }
}
