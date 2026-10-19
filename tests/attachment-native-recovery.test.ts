import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentService } from '../apps/daemon/src/attachments/service.js';
import { nativeClaudeMedia } from '../apps/daemon/src/attachments/native.js';
import type { AttachmentDescriptor, Session } from '@protocol';

const bytes = Buffer.from('synthetic image bytes');

const descriptor: AttachmentDescriptor = {
  id: 'image',
  name: 'image.png',
  mimeType: 'image/png',
  kind: 'image',
  byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

const session = {
  id: 'synthetic',
  generation: 'g',
  target: { kind: 'claude-code-cli', deviceId: 'd', connectorId: 'native', claudeSessionId: 'source' },
} as Session;

const message = { id: 'm', role: 'user' as const, text: 'Review\n[Image #116]', occurredAt: 1 };

const source = {
  type: 'user',
  imagePasteIds: [116],
  message: {
    content: [
      { type: 'text', text: message.text },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') } },
    ],
  },
};

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'native-recovery-'));

  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(descriptor)));

  const service = new AttachmentService({
    relayUrl: 'http://127.0.0.1:3000',
    deviceToken: 'synthetic',
    directory,
    fetch: fetcher,
  });

  cleanup.push(() => service.close());

  return { service, fetcher };
}

it('retries native images after a rejected network request without losing the source marker', async () => {
  const f = await fixture();

  f.fetcher.mockRejectedValueOnce(new TypeError('fetch failed'));
  expect(await f.service.normalize(session, message, nativeClaudeMedia(source))).toEqual(message);
  const published: unknown[] = [];

  await f.service.retryExports((_session, restored) => published.push(restored));
  expect(published).toEqual([{ ...message, text: 'Review', attachments: [descriptor] }]);
});

it('retries native images after the upload response stream disconnects', async () => {
  const f = await fixture();

  f.fetcher.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('connection closed'));
        },
      }),
    ),
  );

  expect(await f.service.normalize(session, message, nativeClaudeMedia(source))).toEqual(message);
  const published: unknown[] = [];

  await f.service.retryExports((_session, restored) => published.push(restored));
  expect(published).toEqual([{ ...message, text: 'Review', attachments: [descriptor] }]);
});

it('coalesces uploads for concurrent live and paginated reads of the same native message', async () => {
  const f = await fixture();
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  f.fetcher.mockImplementation(async () => {
    await gate;

    return new Response(JSON.stringify(descriptor));
  });

  const first = f.service.normalize(session, { ...message, text: 'Review' }, nativeClaudeMedia(source));
  const second = f.service.normalize(session, { ...message, text: 'Review' }, nativeClaudeMedia(source));

  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalled());
  release();

  expect(await Promise.all([first, second])).toEqual([
    { ...message, text: 'Review', attachments: [descriptor] },
    { ...message, text: 'Review', attachments: [descriptor] },
  ]);

  expect(f.fetcher).toHaveBeenCalledTimes(1);
});

it('keeps unproven image labels and removes only the successfully exported native label', async () => {
  const f = await fixture();
  const text = 'Example [Image #115]\nReview\n[Image #116]';

  expect(await f.service.normalize(session, { ...message, text }, nativeClaudeMedia(source))).toEqual({
    ...message,
    text: 'Example [Image #115]\nReview',
    attachments: [descriptor],
  });

  expect(await f.service.normalize(session, { ...message, id: 'plain', text }, [])).toEqual({
    ...message,
    id: 'plain',
    text,
  });
});

it('preserves a quoted copy before the native image label', async () => {
  const f = await fixture();
  const text = 'Quoted [Image #116]\nReview\n[Image #116]';

  expect(await f.service.normalize(session, { ...message, text }, nativeClaudeMedia(source))).toEqual({
    ...message,
    text: 'Quoted [Image #116]\nReview',
    attachments: [descriptor],
  });
});

it('preserves label text when the native record has no paste provenance', async () => {
  const f = await fixture();

  expect(
    await f.service.normalize(session, message, nativeClaudeMedia({ ...source, imagePasteIds: undefined })),
  ).toEqual({ ...message, attachments: [descriptor] });
});

it('releases a failed coalesced upload so the native source can retry', async () => {
  const f = await fixture();

  f.fetcher.mockRejectedValueOnce(new TypeError('fetch failed'));
  expect(await f.service.normalize(session, message, nativeClaudeMedia(source))).toEqual(message);

  expect(await f.service.normalize(session, message, nativeClaudeMedia(source))).toEqual({
    ...message,
    text: 'Review',
    attachments: [descriptor],
  });
});

it('revalidates cached native exports and rebuilds evicted bytes with source position metadata', async () => {
  const f = await fixture();
  const native = nativeClaudeMedia(source)[0]!;

  await f.service.export(session, 'm:0', native, { messageId: 'm', position: 'position:synthetic' });
  f.fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));

  await expect(
    f.service.export(session, 'm:0', native, { messageId: 'm', position: 'position:synthetic' }),
  ).resolves.toEqual(descriptor);

  expect(f.fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'HEAD', 'POST']);

  expect(f.fetcher.mock.calls[2]![1]?.headers).toMatchObject({
    'x-source-message-id': 'm',
    'x-source-position': 'position:synthetic',
  });
});

it('upgrades a cached live image with a durable source position on its first paginated read', async () => {
  const f = await fixture(),
    native = nativeClaudeMedia(source)[0]!;

  await f.service.export(session, 'm:0', native);
  await f.service.export(session, 'm:0', native, { messageId: 'm', position: 'position:synthetic' });
  expect(f.fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'POST']);
  expect(f.fetcher.mock.calls[1]![1]?.headers).toMatchObject({ 'x-source-position': 'position:synthetic' });
});
