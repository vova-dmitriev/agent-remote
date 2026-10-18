import { expect, it } from 'vitest';
import { fragmentValue, FragmentReader } from '../packages/transport/src/native/fragments.js';
import { decodeBase64 } from '../packages/transport/src/native/base64.js';
import { ErrorCode } from '../packages/protocol/src/error-codes.js';
import { LocalKind } from '../packages/protocol/src/values/local-client.js';

function piece(transferId: string, total: number, data = 'Ig==', seq = 0) {
  return { kind: LocalKind.Fragment, transferId, seq, total, data };
}

it('round-trips an 8 MiB logical message with Unicode across chunk boundaries', () => {
  const original = `${'x'.repeat(262142)}👋${'x'.repeat(8126460)}`;
  const pieces = fragmentValue(original, 'maximum');
  const reader = new FragmentReader();
  let restored: unknown;

  expect(pieces).toHaveLength(32);
  expect(Buffer.from(pieces[0]!.data, 'base64')).toHaveLength(262144);

  for (const chunk of pieces) {
    restored = reader.accept(chunk, 0);
  }

  expect(restored).toBe(original);
  expect(() => fragmentValue(`${original}x`, 'oversized')).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
});

it('reserves declared totals and accepts exactly 16 MiB aggregate pending bytes', () => {
  const reader = new FragmentReader();

  expect(reader.accept(piece('first', 8388608), 0)).toBeUndefined();
  expect(reader.accept(piece('second', 8388608), 0)).toBeUndefined();
  expect(() => reader.accept(piece('overflow', 1), 0)).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  reader.clear();
  expect(reader.accept(piece('after-disconnect', 8388608), 0)).toBeUndefined();
});

it('bounds concurrent transfers independently of their declared size', () => {
  const reader = new FragmentReader();

  for (let index = 0; index < 16; index++) {
    reader.accept(piece(`transfer-${index}`, 2), 0);
  }

  expect(() => reader.accept(piece('seventeenth', 2), 0)).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
  expect(reader.accept(piece('after-expiry', 2), 30000)).toBeUndefined();
});

it('expires at exactly 30 seconds and does not extend expiry on progress', () => {
  const reader = new FragmentReader();

  reader.accept(piece('expiring', 3), 1000);
  expect(reader.accept(piece('expiring', 3, 'eA==', 1), 30999)).toBeUndefined();

  expect(() => reader.accept(piece('expiring', 3, 'Ig==', 2), 31000)).toThrow(
    ErrorCode.LOCAL_TRANSFER_EXPIRED,
  );

  expect(reader.accept(piece('new', 8388608), 31000)).toBeUndefined();
});

it.each([
  { seq: 2 },
  { total: 3 },
  { seq: -1 },
  { extra: true },
  { data: '@@@@' },
  { seq: 33 },
  { total: 8388609 },
])('rejects corrupt continuation metadata and releases its quota: %j', (change) => {
  const reader = new FragmentReader();

  reader.accept(piece('broken', 8388608), 0);
  reader.accept(piece('other', 8388608), 0);
  expect(() => reader.accept({ ...piece('broken', 8388608, 'eA==', 1), ...change }, 0)).toThrow();
  expect(reader.accept(piece('replacement', 8388608), 0)).toBeUndefined();
});

it('rejects out-of-order beginnings and oversized declarations before reassembly', () => {
  const reader = new FragmentReader();

  expect(() => reader.accept(piece('out-of-order', 2, 'Ig==', 1), 0)).toThrow(ErrorCode.INVALID_FRAME);
  expect(() => reader.accept(piece('oversized', 8388609), 0)).toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
});

it('rejects duplicate sequence numbers and recent completed transfer IDs', () => {
  const reader = new FragmentReader();

  reader.accept(piece('pending', 2), 0);
  expect(() => reader.accept(piece('pending', 2), 0)).toThrow(ErrorCode.INVALID_FRAME);
  expect(reader.accept(piece('done', 2, 'IiI='), 0)).toBe('');
  expect(() => reader.accept(piece('done', 2, 'IiI='), 0)).toThrow(ErrorCode.INVALID_FRAME);
  reader.clear();
  expect(reader.accept(piece('done', 2, 'IiI='), 0)).toBe('');
});

it.each(['', 'Zg', 'Zg=', 'Zg===', ' Zg==', 'Zg==\n', 'Zh==', 'Zm9=', '____'])(
  'rejects malformed or noncanonical base64: %j',
  (data) => {
    expect(() => new FragmentReader().accept(piece('invalid', 2, data), 0)).toThrow(ErrorCode.INVALID_FRAME);
  },
);

it('rejects chunks above 256 KiB before accepting any bytes', () => {
  const data = Buffer.alloc(262145, 0x78).toString('base64');

  expect(() => new FragmentReader().accept(piece('huge-chunk', 8388608, data), 0)).toThrow(
    ErrorCode.INVALID_FRAME,
  );
});

it.each(['IsCvIg==', 'ew=='])('rejects malformed UTF-8 or JSON after reassembly: %s', (data) => {
  expect(() =>
    new FragmentReader().accept(piece('bad-json', Buffer.from(data, 'base64').length, data), 0),
  ).toThrow(ErrorCode.INVALID_FRAME);
});

it('base64 decoding handles a maximum-sized chunk without recursive regex overflow', () => {
  const data = Buffer.alloc(262144, 0xff);

  expect(decodeBase64(data.toString('base64'))).toEqual(new Uint8Array(data));
});

it.each(['Zh==', 'Zm9='])('rejects noncanonical padding bits before decoding: %s', (data) => {
  expect(() => decodeBase64(data)).toThrow(ErrorCode.INVALID_FRAME);
});

it.each([undefined, 1n])('reports unserializable logical values as INVALID_FRAME', (value) => {
  expect(() => fragmentValue(value, 'invalid')).toThrow(ErrorCode.INVALID_FRAME);
});

it.each(['', 'x'.repeat(513)])('rejects outgoing transfer IDs outside the wire bounds', (id) => {
  expect(() => fragmentValue(null, id)).toThrow(ErrorCode.INVALID_FRAME);
});

it('rejects sequence numbers beyond the bounded 32-chunk logical envelope', () => {
  const reader = new FragmentReader();

  for (let seq = 0; seq < 32; seq++) {
    reader.accept(piece('too-many-chunks', 100, 'eA==', seq), 0);
  }

  expect(() => reader.accept(piece('too-many-chunks', 100, 'eA==', 32), 0)).toThrow(ErrorCode.INVALID_FRAME);
});
