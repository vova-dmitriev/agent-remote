import { expect, it, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalOperation, ErrorCode, type AttachmentDescriptor } from '../packages/protocol/src/index.js';
import { restartWithExpiredStage } from './helpers/extension-media-runtime.js';
import { fixture, begin, session, principal, controlledBody } from './helpers/extension-media-runtime.js';

afterEach(() => vi.restoreAllMocks());

it.each([
  { ownerId: 'foreign' },
  { clientId: 'foreign' },
  { lease: 'foreign' },
  { deviceId: 'foreign' },
  { origin: 'chrome-extension://foreign' },
])('binds every transfer to the approved principal: %j', async (change) => {
  const f = fixture();
  const { transferId } = (await f.run(begin())) as { transferId: string };

  await expect(
    f.run(
      { operation: LocalOperation.MediaChunk, transferId, offset: 0, data: 'YWJj' },
      { ...principal, ...change },
    ),
  ).rejects.toThrow();

  expect(await f.run({ operation: LocalOperation.MediaChunk, transferId, offset: 0, data: 'YWJj' })).toEqual({
    offset: 3,
  });
});

it.each(['revoke', 'generation'])(
  'rejects changed authorization and removes staged bytes: %s',
  async (change) => {
    const f = fixture();
    const { transferId } = (await f.run(begin())) as { transferId: string };

    if (change === 'revoke') {
      f.state.current = false;
    } else {
      f.state.session.generation = 'new-generation';
    }

    await expect(
      f.run({ operation: LocalOperation.MediaChunk, transferId, offset: 0, data: 'YWJj' }),
    ).rejects.toThrow();

    expect(readdirSync(f.options.directory)).toEqual([]);
  },
);

it('validates persisted file size and digest and rejects symlinks and traversal', async () => {
  const f = fixture();

  const response = await f.repository.request(session, undefined, {
    method: 'POST',
    headers: {
      'x-upload-id': randomUUID(),
      'x-file-name': 'synthetic.txt',
      'x-session-generation': session.generation,
      'content-type': 'text/plain',
    },
    body: 'abc',
  });

  const descriptor = (await response!.json()) as AttachmentDescriptor;

  writeFileSync(join(f.options.directory, descriptor.id), 'xyz');

  await expect(f.repository.request(session, descriptor.id)).rejects.toThrow(
    ErrorCode.ATTACHMENT_INTEGRITY_FAILED,
  );

  rmSync(join(f.options.directory, descriptor.id));
  symlinkSync(join(f.root, 'state.sqlite'), join(f.options.directory, descriptor.id));
  await expect(f.repository.request(session, descriptor.id)).rejects.toThrow();

  await expect(f.repository.request(session, '../state.sqlite')).rejects.toThrow(
    ErrorCode.INVALID_ATTACHMENT,
  );

  expect(await f.repository.request(session, randomUUID())).toBeNull();
});

it('expires staged bytes at five minutes without extending expiry on progress', async () => {
  let now = 1000;

  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture();
  const { transferId } = (await f.run(begin())) as { transferId: string };

  now = 301000;

  await expect(
    f.run({ operation: LocalOperation.MediaChunk, transferId, offset: 0, data: 'YWJj' }),
  ).rejects.toThrow(ErrorCode.LOCAL_TRANSFER_EXPIRED);

  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('denies upload and read when session observation is revoked', async () => {
  const f = fixture();

  f.state.session.capabilities.observe = false;
  await expect(f.run(begin())).rejects.toThrow(ErrorCode.STALE_SESSION);

  await expect(
    f.run({ operation: LocalOperation.MediaRead, sessionId: session.id, attachmentId: randomUUID() }),
  ).rejects.toThrow(ErrorCode.STALE_SESSION);

  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('checks source generation again after an asynchronous trusted upload body', async () => {
  const f = fixture();
  const stream = controlledBody();

  const pending = f.repository.request(f.state.session, undefined, {
    method: 'POST',
    headers: { 'x-session-generation': session.generation },
    body: stream.body,
  });

  await stream.reading;
  f.state.session.generation = 'new-generation';
  stream.controller.enqueue(new Uint8Array([97]));
  stream.controller.close();
  await expect(pending).rejects.toThrow(ErrorCode.STALE_SESSION);
  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('cancels an in-flight body when closing and never publishes its bytes', async () => {
  const f = fixture();
  const stream = controlledBody();

  const pending = f.repository.request(session, undefined, {
    method: 'POST',
    headers: { 'x-session-generation': session.generation },
    body: stream.body,
  });

  const closing = f.repository.close();

  await Promise.resolve();

  try {
    expect(stream.cancelled).toBe(true);
  } finally {
    if (!stream.cancelled) {
      stream.controller.close();
    }

    await Promise.allSettled([pending, closing]);
  }

  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('rejects malformed upload identities instead of accepting UUID-shaped separators', async () => {
  const f = fixture();

  await expect(f.run({ ...begin(), uploadId: '-'.repeat(36) })).rejects.toThrow(ErrorCode.INVALID_ATTACHMENT);
});

it('bounds simultaneous trusted body streams before retaining upload bytes', async () => {
  const f = fixture();
  const streams = Array.from({ length: 17 }, () => controlledBody());

  const init = (body: ReadableStream<Uint8Array>) => ({
    method: 'POST',
    headers: { 'x-session-generation': session.generation },
    body,
  });

  const pending = streams
    .slice(0, 16)
    .map((stream) => f.repository.request(session, undefined, init(stream.body)).catch(() => null));

  streams[16]!.controller.close();

  try {
    await expect(f.repository.request(session, undefined, init(streams[16]!.body))).rejects.toThrow(
      ErrorCode.ATTACHMENT_QUOTA,
    );
  } finally {
    await f.repository.close();
    await Promise.all(pending);
    await streams[16]!.body.cancel().catch(() => {});
  }
});

it('expires orphan staging left by an interrupted process', () => {
  const f = fixture();

  restartWithExpiredStage(f);
  expect(readdirSync(f.options.directory)).toEqual([]);
});
