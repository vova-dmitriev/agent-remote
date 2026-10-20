import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DesktopIpcClient } from '../../../../apps/daemon/src/codex/desktop/desktop-ipc.js';
import { OversizeFrame } from '../../../../apps/daemon/src/codex/desktop/oversize-frame.js';
import { RuntimeEvent } from '../../../../apps/daemon/src/domain/runtime.js';

const FRAME_CAP = 32 * 1024 * 1024;
const RETRY_AFTER_MS = 10 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

/** A client driven chunk by chunk through a synthetic socket, so every boundary is deterministic. */
function client() {
  const socket = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    write: vi.fn(() => true),
    writableLength: 0,
  });

  const Client = DesktopIpcClient as unknown as new (socket: unknown, timeoutMs: number) => DesktopIpcClient;
  const ipc = new Client(socket, 1000);
  const broadcasts: Record<string, unknown>[] = [];
  const oversized: unknown[] = [];
  let disconnected = 0;

  ipc.on(RuntimeEvent.Broadcast, (frame) => broadcasts.push(frame));
  ipc.on(RuntimeEvent.FrameTooLarge, (route) => oversized.push(route));
  ipc.on(RuntimeEvent.Disconnected, () => disconnected++);

  return {
    ipc,
    socket,
    broadcasts,
    oversized,
    disconnected: () => disconnected,
    feed: (...chunks: Buffer[]) => {
      for (const chunk of chunks) {
        socket.emit('data', chunk);
      }
    },
  };
}

function header(length: number) {
  const bytes = Buffer.alloc(4);

  bytes.writeUInt32LE(length);

  return bytes;
}

function frame(value: unknown) {
  const json = Buffer.from(JSON.stringify(value));

  return Buffer.concat([header(json.length), json]);
}

function broadcast(conversationId: string, sourceClientId = 'owner') {
  return frame({
    type: 'broadcast',
    method: 'thread-stream-state-changed',
    version: 11,
    sourceClientId,
    params: { conversationId },
  });
}

/** An oversize broadcast body (no header) for `conversationId`, padded past the cap. */
function oversizeBody(conversationId: string, sourceClientId?: string) {
  const source = sourceClientId ? `"sourceClientId":${JSON.stringify(sourceClientId)},` : '';
  const prefix = `{"type":"broadcast",${source}"params":{"conversationId":${JSON.stringify(conversationId)},"blob":"`;
  const suffix = '"}}';
  const body = Buffer.alloc(FRAME_CAP + 16, 'x');

  body.write(prefix, 0);
  body.write(suffix, body.length - suffix.length);

  return body;
}

it('drains an oversize payload split across chunks and parses the frame sharing its last chunk', () => {
  const c = client();
  const body = oversizeBody('big', 'owner');
  const third = Math.floor(body.length / 3);

  c.feed(
    Buffer.concat([header(body.length), body.subarray(0, 10)]),
    body.subarray(10, third),
    body.subarray(third, 2 * third),
    Buffer.concat([body.subarray(2 * third), broadcast('small')]),
  );

  expect(c.oversized).toEqual([{ conversationId: 'big', sourceClientId: 'owner' }]);
  expect(c.broadcasts).toMatchObject([{ params: { conversationId: 'small' } }]);
  expect(c.disconnected()).toBe(0);
});

it('accepts a frame header split 3 + 1 for both oversize and ordinary frames', () => {
  const c = client();
  const body = oversizeBody('big', 'owner');
  const oversizeHeader = header(body.length);
  const next = broadcast('small');

  c.feed(
    oversizeHeader.subarray(0, 3),
    oversizeHeader.subarray(3),
    body,
    next.subarray(0, 3),
    next.subarray(3),
  );

  expect(c.oversized).toHaveLength(1);
  expect(c.broadcasts).toHaveLength(1);
  expect(c.disconnected()).toBe(0);
});

it('disconnects on a garbled length so the manager reconnects instead of stalling', async () => {
  const c = client();
  const owner = c.ipc.owner('thread');
  const valid = Array.from({ length: 1000 }, () => broadcast('small'));

  c.feed(header(0xffffffff), ...valid);

  expect(c.disconnected()).toBe(1);
  expect(c.socket.destroy).toHaveBeenCalled();
  expect(c.broadcasts).toHaveLength(0);
  expect(c.oversized).toHaveLength(0);
  await expect(owner).resolves.toBeNull();
});

it('disconnects when an oversize payload closes early, goes below depth zero or does not open an object', () => {
  for (const garbage of [
    Buffer.concat([Buffer.from('{}'), Buffer.from('x')]),
    Buffer.from('}'.repeat(16)),
    Buffer.from('[1]'),
    Buffer.from('"text"'),
  ]) {
    const c = client();
    const body = Buffer.alloc(FRAME_CAP + 16, 0x20);

    garbage.copy(body, 0);
    c.feed(header(body.length), body);

    expect(c.disconnected()).toBe(1);
    expect(c.oversized).toHaveLength(0);
  }
});

it('allows trailing whitespace after an oversize object but rejects a truncated one', () => {
  const valid = new OversizeFrame(8);

  valid.consume(Buffer.from('{"a":1} '));
  expect(valid.done && !valid.invalid).toBe(true);

  const truncated = new OversizeFrame(6);

  truncated.consume(Buffer.from('{"a":1'));
  expect(truncated.invalid).toBe(true);
});

it('stops at negative depth without allocating per nesting level', () => {
  const garbage = Buffer.from('{' + '}'.repeat(2_000_000) + '{'.repeat(2_000_000));
  const frame = new OversizeFrame(garbage.length);

  frame.consume(garbage);

  expect(frame.invalid).toBe(true);
  expect(Object.keys((frame as unknown as { objects: unknown[] }).objects).length).toBeLessThanOrEqual(2);
});

it('remembers an oversize thread only for its owner and only until the retry interval passes', () => {
  vi.useFakeTimers();
  const c = client();

  c.feed(header(FRAME_CAP + 16), oversizeBody('anonymous'));
  expect(c.ipc.frameTooLarge('anonymous', 'owner')).toBe(false);

  c.feed(header(FRAME_CAP + 16), oversizeBody('big', 'owner'));
  expect(c.ipc.frameTooLarge('big', 'owner')).toBe(true);
  expect(c.ipc.frameTooLarge('big', 'another-owner')).toBe(false);

  vi.advanceTimersByTime(RETRY_AFTER_MS - 1);
  expect(c.ipc.frameTooLarge('big', 'owner')).toBe(true);
  vi.advanceTimersByTime(1);
  expect(c.ipc.frameTooLarge('big', 'owner')).toBe(false);
  expect(c.disconnected()).toBe(0);
});

it('disconnects within two bytes when a garbled length swallows a header that starts with `{`', () => {
  const c = client();

  const padding =
    379 -
    JSON.stringify({
      type: 'broadcast',
      sourceClientId: 'owner',
      params: { conversationId: 'small', pad: '' },
    }).length;

  const next = broadcast('small');

  const json = JSON.stringify({
    type: 'broadcast',
    sourceClientId: 'owner',
    params: { conversationId: 'small', pad: 'p'.repeat(padding) },
  });

  const stream = Buffer.concat([Buffer.from(frame(JSON.parse(json))), next, next]);

  expect(stream.subarray(0, 4)).toEqual(Buffer.from([0x7b, 0x01, 0x00, 0x00]));
  c.feed(header(0xffffffff));

  let fed = 0;

  while (c.disconnected() === 0 && fed < stream.length) {
    c.feed(stream.subarray(fed, fed + 1));
    fed++;
  }

  expect(c.disconnected()).toBe(1);
  expect(fed).toBeLessThanOrEqual(2);
  expect(c.broadcasts).toHaveLength(0);
});

it('drains a valid oversize object whose strings carry escaped control characters', () => {
  const c = client();
  const prefix = '{"type":"broadcast","sourceClientId":"owner","params":{"conversationId":"big","text":"';
  const suffix = '"}}';
  const escaped = Buffer.from('line\\nnext\\u0001\\t\\r\\"quoted\\" ');
  const body = Buffer.alloc(40 * 1024 * 1024 + 16, 'x');

  for (let offset = prefix.length; offset + escaped.length < body.length - suffix.length; offset += 4096) {
    escaped.copy(body, offset);
  }

  body.write(prefix, 0);
  body.write(suffix, body.length - suffix.length);
  c.feed(header(body.length), body, broadcast('small'));

  expect(c.disconnected()).toBe(0);
  expect(c.oversized).toEqual([{ conversationId: 'big', sourceClientId: 'owner' }]);
  expect(c.broadcasts).toHaveLength(1);
});

it('keeps the owner mark when another client sends an oversize broadcast for the same thread', () => {
  vi.useFakeTimers();
  const c = client();

  c.feed(header(FRAME_CAP + 16), oversizeBody('big', 'owner'));
  vi.advanceTimersByTime(RETRY_AFTER_MS - 1000);
  c.feed(header(FRAME_CAP + 16), oversizeBody('big', 'intruder'));

  expect(c.ipc.frameTooLarge('big', 'owner')).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(c.ipc.frameTooLarge('big', 'owner')).toBe(false);
  expect(c.ipc.frameTooLarge('big', 'intruder')).toBe(true);
});
