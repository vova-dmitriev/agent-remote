import { expect, it, vi } from 'vitest';
import { ErrorCode, LocalKind, LocalOperation } from '@protocol';
import { broker } from './extension-client.fixture.js';
import { ExtensionMedia } from '../apps/chrome-extension/src/client/media/transfer.js';

it('uploads acknowledged chunks and aborts interrupted media transfers', async () => {
  const viewer = broker();

  await viewer.ready();
  const media = new ExtensionMedia(viewer.connection);
  const controller = new AbortController();

  const upload = media.upload(
    's',
    'g',
    new File([new Uint8Array(300_000)], 'test.bin'),
    crypto.randomUUID(),
    controller.signal,
    () => {},
  );

  const rejected = expect(upload).rejects.toThrow(ErrorCode.ATTACHMENT_CANCELLED);

  viewer.reply({
    kind: LocalKind.Result,
    requestId: viewer.sent.at(-1)!.requestId,
    ok: true,
    data: { transferId: 'transfer' },
  });

  await vi.waitFor(() =>
    expect(viewer.sent.at(-1)!.action).toMatchObject({ operation: LocalOperation.MediaChunk, offset: 0 }),
  );

  expect((viewer.sent.at(-1)!.action as { data: string }).data.length).toBe(349_528);
  controller.abort();
  await rejected;

  expect(viewer.sent.at(-1)!.action).toEqual({
    operation: LocalOperation.MediaAbort,
    transferId: 'transfer',
  });

  media.close();
  viewer.connection.close();
});

it.each([
  { hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', valid: true },
  { hash: '0000000000000000000000000000000000000000000000000000000000000000', valid: false },
])('checks downloaded attachment integrity: $valid', async ({ hash, valid }) => {
  const viewer = broker();

  await viewer.ready();
  const media = new ExtensionMedia(viewer.connection);

  const download = media.download(
    'session',
    '12345678-1234-4234-8234-123456789abc',
    new AbortController().signal,
  );

  const result = valid
    ? download.then((blob) => blob.text())
    : expect(download).rejects.toThrow(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);

  viewer.reply({
    kind: LocalKind.Result,
    requestId: viewer.sent.at(-1)!.requestId,
    ok: true,
    data: {
      transferId: 'read',
      descriptor: {
        id: '12345678-1234-4234-8234-123456789abc',
        name: 'hello.txt',
        mimeType: 'text/plain',
        kind: 'file',
        byteLength: 5,
        sha256: hash,
      },
    },
  });

  await vi.waitFor(() =>
    expect(viewer.sent.at(-1)!.action).toEqual({
      operation: LocalOperation.MediaReadChunk,
      transferId: 'read',
      offset: 0,
    }),
  );

  viewer.reply({
    kind: LocalKind.Result,
    requestId: viewer.sent.at(-1)!.requestId,
    ok: true,
    data: { data: 'aGVsbG8=', done: true },
  });

  if (valid) {
    expect(await result).toBe('hello');
  } else {
    await result;
  }

  expect(viewer.sent.at(-1)!.action).toEqual({ operation: LocalOperation.MediaAbort, transferId: 'read' });
  media.close();
  viewer.connection.close();
});
