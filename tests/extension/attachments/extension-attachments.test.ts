import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LocalMediaRepository } from '../../../apps/daemon/src/local/media/repository.js';
import { LocalOperation, ErrorCode, type AttachmentDescriptor } from '@protocol';
import { fillTransfers } from '../../helpers/extension-media-runtime.js';
import { fixture, begin, session, cleanup } from '../../helpers/extension-media-runtime.js';

it.each(['text/plain', 'image/png', 'image/svg+xml'])(
  'persists opaque private files and canonical descriptors: %s',
  async (mimeType) => {
    const f = fixture();

    const bytes =
      mimeType === 'image/png'
        ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')
        : Buffer.from('synthetic Я');

    const { transferId } = (await f.run({ ...begin(bytes.length), mimeType })) as { transferId: string };

    expect(
      await f.run({
        operation: LocalOperation.MediaChunk,
        transferId,
        offset: 0,
        data: bytes.toString('base64'),
      }),
    ).toEqual({ offset: bytes.length });

    const descriptor = (await f.run({
      operation: LocalOperation.MediaFinish,
      transferId,
    })) as AttachmentDescriptor;

    expect(descriptor).toMatchObject({
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType,
      kind: mimeType === 'image/png' ? 'image' : 'file',
    });

    expect(descriptor.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(readFileSync(join(f.options.directory, descriptor.id))).toEqual(bytes);
    expect(statSync(join(f.options.directory, descriptor.id)).mode & 0o777).toBe(0o600);
    expect(statSync(f.options.directory).mode & 0o777).toBe(0o700);

    const read = (await f.run({
      operation: LocalOperation.MediaRead,
      sessionId: session.id,
      attachmentId: descriptor.id,
    })) as { transferId: string };

    expect(
      await f.run({ operation: LocalOperation.MediaReadChunk, transferId: read.transferId, offset: 0 }),
    ).toEqual({ data: bytes.toString('base64'), done: true });

    await f.repository.close();
    const reopened = new LocalMediaRepository(f.options);

    cleanup.push(() => reopened.close());
    expect(await (await reopened.request(session, descriptor.id))!.text()).toBe(bytes.toString());
  },
);

it('accepts exactly 10 MiB in acknowledged 256 KiB chunks and rejects larger files/chunks', async () => {
  const f = fixture();
  const { transferId } = (await f.run(begin(10485760))) as { transferId: string };
  const data = Buffer.alloc(262144, 120).toString('base64');

  for (let offset = 0; offset < 10485760; offset += 262144) {
    expect(await f.run({ operation: LocalOperation.MediaChunk, transferId, offset, data })).toEqual({
      offset: offset + 262144,
    });
  }

  expect(await f.run({ operation: LocalOperation.MediaFinish, transferId })).toMatchObject({
    byteLength: 10485760,
  });

  await expect(f.run(begin(10485761))).rejects.toThrow(ErrorCode.ATTACHMENT_TOO_LARGE);
  const small = (await f.run(begin(262145))) as { transferId: string };

  await expect(
    f.run({
      operation: LocalOperation.MediaChunk,
      transferId: small.transferId,
      offset: 0,
      data: Buffer.alloc(262145).toString('base64'),
    }),
  ).rejects.toThrow(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
});

it('rejects wrong offsets, malformed base64 and incomplete finish without publishing files', async () => {
  const f = fixture();
  const { transferId } = (await f.run(begin())) as { transferId: string };

  await expect(
    f.run({ operation: LocalOperation.MediaChunk, transferId, offset: 1, data: 'YWJj' }),
  ).rejects.toThrow(ErrorCode.INVALID_FRAME);

  await expect(
    f.run({ operation: LocalOperation.MediaChunk, transferId, offset: 0, data: 'Zh==' }),
  ).rejects.toThrow(ErrorCode.INVALID_FRAME);

  await expect(f.run({ operation: LocalOperation.MediaFinish, transferId })).rejects.toThrow(
    ErrorCode.ATTACHMENT_INTEGRITY_FAILED,
  );

  await f.run({ operation: LocalOperation.MediaAbort, transferId });
  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('reserves declared file sizes against the session quota before writing', async () => {
  const f = fixture();

  for (let index = 0; index < 12; index++) {
    await f.run(begin(10485760));
  }

  await expect(f.run(begin(10485760))).rejects.toThrow(ErrorCode.ATTACHMENT_QUOTA);
  await f.run(begin(8388608));
  await expect(f.run(begin(1))).rejects.toThrow(ErrorCode.ATTACHMENT_QUOTA);
  await f.repository.close();
  expect(readdirSync(f.options.directory)).toEqual([]);
});

it('bounds parallel transfer count separately from total bytes', async () => {
  const f = fixture();

  for (let index = 0; index < 16; index++) {
    await f.run(begin());
  }

  await expect(f.run(begin())).rejects.toThrow(ErrorCode.ATTACHMENT_QUOTA);
});

it('handles trusted native exports idempotently and preserves source binding', async () => {
  const f = fixture();
  const action = begin();

  const init = {
    method: 'POST',
    headers: {
      'x-upload-id': action.uploadId,
      'x-file-name': encodeURIComponent(action.name),
      'x-session-generation': session.generation,
      'content-type': 'text/plain',
      'x-source-message-id': 'message',
      'x-source-position': 'position:one',
    },
    body: 'abc',
  };

  const first = await f.repository.request(session, undefined, init);
  const descriptor = (await first!.json()) as AttachmentDescriptor;
  const second = await f.repository.request(session, undefined, init);

  expect(await second!.json()).toEqual(descriptor);
  expect(second!.headers.get('x-attachment-cache-hit')).toBe('1');
  const modified = { ...init, headers: { ...init.headers, 'x-source-position': 'position:two' } };

  await expect(f.repository.request(session, undefined, modified)).rejects.toThrow(
    ErrorCode.ATTACHMENT_ID_REUSED,
  );

  expect(readdirSync(f.options.directory)).toEqual([descriptor.id]);
});

it('imports trusted remote descriptor identities without changing IDs or accepting altered metadata', async () => {
  const f = fixture();
  const bytes = Buffer.from('remote synthetic');

  const descriptor: AttachmentDescriptor = {
    id: begin().uploadId,
    name: 'remote.txt',
    mimeType: 'text/plain',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    kind: 'file',
  };

  await f.repository.importDescriptor(session, descriptor, bytes);

  await expect(
    f.repository.importDescriptor(session, { ...descriptor, id: begin().uploadId }, Buffer.from('corrupt')),
  ).rejects.toThrow(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);

  await fillTransfers(f);
  await f.repository.importDescriptor(session, descriptor, bytes);
  expect(await (await f.repository.request(session, descriptor.id))!.text()).toBe('remote synthetic');

  await expect(
    f.repository.importDescriptor(session, { ...descriptor, name: 'changed.txt' }, bytes),
  ).rejects.toThrow(ErrorCode.ATTACHMENT_ID_REUSED);

  await f.repository.close();
  expect(readdirSync(f.options.directory)).toEqual([descriptor.id]);
});
