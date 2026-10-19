import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpStatus } from '@protocol';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentService } from '../apps/daemon/src/attachments/service.js';
import { nativeCodexMedia, nativeClaudeMedia } from '../apps/daemon/src/attachments/content/native.js';
import { attachmentPrompt, codexAttachmentInput } from '../apps/daemon/src/attachments/content/input.js';
import type { AttachmentDescriptor, Session } from '@protocol';

const bytes = Buffer.from('synthetic file contents');

const descriptor: AttachmentDescriptor = {
  id: 'one',
  name: '../../private $(touch nope).txt',
  mimeType: 'text/plain',
  byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  kind: 'file',
};

const session = {
  id: 's',
  generation: 'g',
  target: { kind: 'codex-cli', deviceId: 'd', connectorId: 'c', threadId: 't' },
} as Session;

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

async function fixture(body: Buffer = bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'attachment-daemon-'));

  cleanup.push(() => rm(directory, { recursive: true, force: true }));

  const fetcher = vi.fn(
    async (_url: URL | RequestInfo, _init?: RequestInit) =>
      new Response(new Uint8Array(body), { headers: { 'content-length': String(body.length) } }),
  );

  const service = new AttachmentService({
    relayUrl: 'http://127.0.0.1:3000',
    deviceToken: 'test',
    directory,
    fetch: fetcher,
  });

  cleanup.push(() => service.close());

  return { service, fetcher, directory };
}

describe('private daemon attachments', () => {
  it('downloads into generated private paths and verifies canonical bytes', async () => {
    const f = await fixture();
    const [prepared] = await f.service.prepare(session, [descriptor]);

    expect(prepared!.descriptor).toEqual(descriptor);
    expect(prepared!.path).not.toContain('private $');
    expect(await readFile(prepared!.path)).toEqual(bytes);
    expect((await stat(prepared!.path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(prepared!.path, '..'))).mode & 0o777).toBe(0o700);
    expect(f.fetcher.mock.calls[0]![0].toString()).toContain('/device/sessions/s/attachments/one');
  });

  it('rejects altered/truncated bodies before any prepared input exists', async () => {
    const f = await fixture(Buffer.from('wrong'));

    await expect(f.service.prepare(session, [descriptor])).rejects.toThrow('ATTACHMENT_INTEGRITY_FAILED');
  });

  it('round trips original media-only text and canonical metadata', async () => {
    const f = await fixture();
    const prepared = await f.service.prepare(session, [descriptor]);

    await f.service.remember(session, '', prepared);
    const sent = attachmentPrompt('', prepared);
    const restored = f.service.restore(session, { id: 'm', role: 'user', text: sent, occurredAt: 1 });

    expect(restored).toEqual({ id: 'm', role: 'user', text: '', occurredAt: 1, attachments: [descriptor] });

    expect(
      f.service.restore({ ...session, id: 'foreign' }, { id: 'm', role: 'user', text: sent, occurredAt: 1 })
        .attachments,
    ).toBeUndefined();
  });

  it('maps images to native Codex localImage and files to explicit references', () => {
    const image = {
      descriptor: {
        ...descriptor,
        id: 'img',
        name: 'image.png',
        mimeType: 'image/png',
        kind: 'image' as const,
      },
      path: '/private/generated.png',
    };

    const file = { descriptor, path: '/private/generated.bin' };

    expect(codexAttachmentInput('Review', [image, file])).toEqual([
      { type: 'text', text: attachmentPrompt('Review', [file]) },
      { type: 'localImage', path: image.path },
    ]);
  });

  it('extracts only explicit image/document records, never arbitrary model paths/URLs', () => {
    const data = Buffer.from('fake bytes').toString('base64');

    expect(nativeCodexMedia({ type: 'agentMessage', text: '![x](/etc/passwd)' })).toEqual([]);
    expect(nativeCodexMedia({ type: 'imageGeneration', result: 'https://internal/private' })).toEqual([]);

    expect(
      nativeCodexMedia({
        type: 'userMessage',
        content: [{ type: 'image', url: `data:image/png;base64,${data}` }],
      })[0]?.bytes,
    ).toEqual(Buffer.from('fake bytes'));

    expect(
      nativeClaudeMedia({
        type: 'user',
        message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] },
      })[0]?.bytes,
    ).toEqual(Buffer.from('fake bytes'));

    expect(
      nativeClaudeMedia({
        type: 'attachment',
        attachment: {
          type: 'file',
          filename: '/private/file.pdf',
          content: { type: 'pdf', file: { base64: '' } },
        },
      }),
    ).toEqual([]);
  });

  it('refuses symlink/native non-regular source paths', async () => {
    const f = await fixture();
    const real = join(f.directory, 'original');

    await writeFile(real, bytes);
    const linked = join(f.directory, 'symlink');

    await symlink(real, linked);

    await expect(
      f.service.export(session, 'native-image', { name: 'image.png', mimeType: 'image/png', path: linked }),
    ).rejects.toThrow('ATTACHMENT_SOURCE_UNAVAILABLE');

    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe('native media history retention', () => {
  it('keeps a media-only Claude JSONL message above the old one-MiB limit', async () => {
    const { TranscriptReader } = await import('../apps/daemon/src/code/transcript/transcript-reader.js');
    const directory = await mkdtemp(join(tmpdir(), 'native-media-'));

    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'synthetic.jsonl');
    const image = Buffer.alloc(1_000_000, 7);

    await writeFile(
      path,
      JSON.stringify({
        type: 'user',
        uuid: 'media',
        timestamp: '2026-10-17T00:00:00Z',
        message: {
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') },
            },
          ],
        },
      }) + '\n',
    );

    const reader = new TranscriptReader({
      path,
      allowedRoot: directory,
      transform: async (message, media) => ({
        ...message,
        attachments: media.length ? [{ ...descriptor, id: 'image', byteLength: image.length }] : [],
      }),
    });

    let messages = await reader.readNext();

    if (!messages.length) {
      messages = await reader.readNext();
    }

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'media',
        text: '',
        attachments: [expect.objectContaining({ id: 'image' })],
      }),
    ]);
  });
});

describe('attachment retention and export recovery', () => {
  it('restores original metadata after generation change and daemon restart', async () => {
    const f = await fixture();
    const prepared = await f.service.prepare(session, [descriptor]);

    await f.service.remember(session, 'Original', prepared);
    await f.service.close();

    const restarted = new AttachmentService({
      relayUrl: 'http://127.0.0.1:3000',
      deviceToken: 'test',
      directory: f.directory,
      fetch: f.fetcher,
    });

    cleanup.push(() => restarted.close());

    const restored = await restarted.normalize(
      { ...session, generation: 'next' },
      { id: 'm', role: 'user', text: attachmentPrompt('Original', prepared), occurredAt: 1 },
    );

    expect(restored.text).toBe('Original');
    expect(restored.attachments).toEqual([descriptor]);
    expect(await readFile(prepared[0]!.path)).toEqual(bytes);
  });

  it('retries explicit native media after the first snapshot has reached the relay', async () => {
    const f = await fixture();
    let available = false;

    f.fetcher.mockImplementation(async () =>
      available
        ? new Response(JSON.stringify(descriptor))
        : new Response(null, { status: HttpStatus.NotFound }),
    );

    const message = { id: 'source', role: 'assistant' as const, text: 'Keeps text', occurredAt: 1 };

    expect(
      await f.service.normalize(session, message, [
        { name: descriptor.name, mimeType: descriptor.mimeType, bytes },
      ]),
    ).toEqual(message);

    available = true;
    const published: unknown[] = [];

    await f.service.retryExports((_source, restored) => published.push(restored));
    expect(published).toEqual([{ ...message, attachments: [descriptor] }]);
  });
});

describe('attachment cache quota', () => {
  it('never removes unexpired source inputs to make room, including after restart', async () => {
    const large = Buffer.alloc(10 * 1024 * 1024, 1);
    const f = await fixture(large);

    const item = {
      ...descriptor,
      byteLength: large.length,
      sha256: createHash('sha256').update(large).digest('hex'),
    };

    let first = '';

    for (let index = 0; index < 5; index++) {
      const [prepared] = await f.service.prepare(session, [{ ...item, id: `large-${index}` }]);

      first ||= prepared!.path;
    }

    await f.service.close();

    const next = new AttachmentService({
      relayUrl: 'http://127.0.0.1:3000',
      deviceToken: 'test',
      directory: f.directory,
      fetch: f.fetcher,
    });

    cleanup.push(() => next.close());
    await expect(next.prepare(session, [item])).rejects.toThrow('ATTACHMENT_QUOTA');
    expect((await stat(first)).size).toBe(large.length);
  });
});

describe('native image round-trip provenance', () => {
  it('does not attach old images to a later identical plain-text prompt', async () => {
    const f = await fixture();

    const prepared = [
      {
        descriptor: { ...descriptor, id: 'image', kind: 'image' as const, mimeType: 'image/png' },
        path: '/private/synthetic-image.png',
      },
    ];

    await f.service.remember(session, 'Describe', prepared);
    const plain = { id: 'later', role: 'user' as const, text: 'Describe', occurredAt: 1 };

    expect(f.service.restore(session, plain)).toEqual(plain);

    expect(f.service.restore(session, plain, [prepared[0]!.path]).attachments).toEqual([
      prepared[0]!.descriptor,
    ]);

    expect(
      f.service.restore(session, { ...plain, text: attachmentPrompt('Describe', prepared) }).attachments,
    ).toEqual([prepared[0]!.descriptor]);
  });
});

it('prunes expired private files without requiring another send', async () => {
  const f = await fixture();
  const [prepared] = await f.service.prepare(session, [descriptor]);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1);

  try {
    await f.service.pruneExpired();
    await expect(stat(prepared!.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    clock.mockRestore();
  }
});

it('does not expose private generated references when a bounded history mapping is unavailable', async () => {
  const f = await fixture();
  const prepared = await f.service.prepare(session, [descriptor]);

  const message = await f.service.normalize(session, {
    id: 'old',
    role: 'user',
    text: attachmentPrompt('Original text', prepared),
    occurredAt: 1,
  });

  expect(message.text).toBe('Original text');
  expect(message.attachments).toBeUndefined();
});

describe('native image path content guard', () => {
  it('never uploads regular non-image bytes named by an explicit image record', async () => {
    const f = await fixture();
    const { realpath } = await import('node:fs/promises');
    const path = join(await realpath(f.directory), 'synthetic-secret.txt');

    await writeFile(path, bytes);
    const message = { id: 'image-path', role: 'assistant' as const, text: 'Visible text', occurredAt: 1 };
    const result = await f.service.normalize(session, message, nativeCodexMedia({ type: 'imageView', path }));

    expect(result).toEqual(message);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('uploads verified PNG bytes from an explicit native image path', async () => {
    const f = await fixture();
    const { realpath } = await import('node:fs/promises');

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    );

    const path = join(await realpath(f.directory), 'synthetic-image.png');

    await writeFile(path, png);

    const image = {
      ...descriptor,
      id: 'native-png',
      name: 'synthetic-image.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    };

    f.fetcher.mockImplementation(async () => new Response(JSON.stringify(image)));

    const result = await f.service.normalize(
      session,
      { id: 'native-image', role: 'assistant', text: '', occurredAt: 1 },
      nativeCodexMedia({ type: 'imageView', path }),
    );

    expect(result.attachments).toEqual([image]);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});

it('recognizes only PNG, JPEG, GIF and WebP signatures for native path export', async () => {
  const { nativeImageMime } = await import('../apps/daemon/src/attachments/content/image-content.js');

  expect(nativeImageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
  expect(nativeImageMime(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
  expect(nativeImageMime(Buffer.from('GIF87a'))).toBe('image/gif');
  expect(nativeImageMime(Buffer.from('GIF89a'))).toBe('image/gif');
  expect(nativeImageMime(Buffer.from('RIFF0000WEBP'))).toBe('image/webp');
  expect(nativeImageMime(Buffer.from('<svg>private data</svg>'))).toBeUndefined();
  expect(nativeImageMime(Buffer.from('%PDF-1.7'))).toBeUndefined();
  expect(nativeImageMime(Buffer.from('synthetic secret text'))).toBeUndefined();
});
