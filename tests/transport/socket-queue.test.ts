import { it, expect } from 'vitest';
import { MAX_RELAY_FRAME_BYTES } from '@protocol';
import { BoundedSender } from '@transport/bounded-sender.js';

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  writes = 0;
  closed = 0;
  pending: Array<(error?: Error) => void> = [];
  send(_text: string, callback: (error?: Error) => void) {
    this.writes++;
    this.pending.push(callback);
  }
  close(code: number) {
    this.closed = code;
  }
}

it('caps undrained frames at 256 even when each payload is tiny', () => {
  const sender = new BoundedSender(),
    socket = new Socket();

  for (let i = 0; i < 256; i++) {
    expect(sender.send(socket, { type: 'heartbeat' })).toBe(true);
  }

  expect(sender.send(socket, { type: 'heartbeat' })).toBe(false);
  expect(socket.writes).toBe(256);
  expect(socket.closed).toBe(1013);
});

it('releases capacity on write completion and caps frames/bytes independently', () => {
  const sender = new BoundedSender(),
    socket = new Socket();

  for (let i = 0; i < 256; i++) {
    sender.send(socket, {});
  }

  socket.pending.shift()!();
  expect(sender.send(socket, {})).toBe(true);
  const large = new Socket();

  expect(sender.send(large, { text: 'x'.repeat(MAX_RELAY_FRAME_BYTES) })).toBe(false);
  expect(large.writes).toBe(0);
  const backedUp = new Socket();

  backedUp.bufferedAmount = 4 * MAX_RELAY_FRAME_BYTES;
  expect(sender.send(backedUp, {})).toBe(false);
  expect(backedUp.writes).toBe(0);
});
