import { endianness } from 'node:os';
import { expect, it } from 'vitest';
import { NativeFrameCodec } from '@daemon/browser/transport/framing.js';
import { ErrorCode } from '@protocol';

function wire(body: Uint8Array, size = body.length): Buffer {
  const header = Buffer.alloc(4);

  if (endianness() === 'LE') {
    header.writeUInt32LE(size);
  } else {
    header.writeUInt32BE(size);
  }

  return Buffer.concat([header, body]);
}

it('reads split prefixes and coalesced Unicode frames by UTF-8 byte length', () => {
  const codec = new NativeFrameCodec();
  const first = wire(Buffer.from('{"text":"Привет 👋"}'));
  const combined = Buffer.concat([first, wire(Buffer.from('{"text":"next"}'))]);

  expect(codec.push(combined.subarray(0, 1))).toEqual([]);
  expect(codec.push(combined.subarray(1, 3))).toEqual([]);
  expect(codec.push(combined.subarray(3, first.length - 1))).toEqual([]);
  expect(codec.push(combined.subarray(first.length - 1))).toEqual([{ text: 'Привет 👋' }, { text: 'next' }]);
  expect(() => codec.finish()).not.toThrow();
});

it('encodes native-endian prefixes containing UTF-8 byte lengths', () => {
  const encoded = new NativeFrameCodec().encode('Я👋');

  expect(encoded).toEqual(wire(Buffer.from('"Я👋"')));
});

it('accepts exactly 512 KiB and rejects one encoded byte more in both directions', () => {
  const codec = new NativeFrameCodec();
  const maximum = 'x'.repeat(524286);

  expect(codec.push(codec.encode(maximum))).toEqual([maximum]);
  expect(() => codec.encode(`${maximum}x`)).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  expect(() => codec.push(wire(Buffer.alloc(0), 524289))).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
});

it.each([
  Buffer.alloc(0),
  Buffer.from('{'),
  Buffer.from([0x22, 0xc0, 0xaf, 0x22]),
  Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]),
  Buffer.from([0x22, 0xf0, 0x9f, 0x22]),
])('rejects empty frames, invalid JSON and malformed UTF-8: %j', (body) => {
  expect(() => new NativeFrameCodec().push(wire(body))).toThrow(ErrorCode.INVALID_FRAME);
});

it.each([1, 2, 3, 4, 5])('rejects partial EOF at byte %i and releases decoder state', (length) => {
  const codec = new NativeFrameCodec();
  const frame = wire(Buffer.from('"ok"'));

  expect(codec.push(frame.subarray(0, length))).toEqual([]);
  expect(() => codec.finish()).toThrow(ErrorCode.INVALID_FRAME);
  expect(codec.push(frame)).toEqual(['ok']);
  expect(() => codec.finish()).not.toThrow();
});

it.each([wire(Buffer.from('{')), wire(Buffer.alloc(0), 524289)])(
  'releases decoder state after a malformed frame',
  (invalid) => {
    const codec = new NativeFrameCodec();

    expect(() => codec.push(invalid)).toThrow();
    expect(codec.push(wire(Buffer.from('null')))).toEqual([null]);
  },
);

it.each([undefined, 1n])('reports unserializable outgoing values as INVALID_FRAME', (value) => {
  expect(() => new NativeFrameCodec().encode(value)).toThrow(ErrorCode.INVALID_FRAME);
});
