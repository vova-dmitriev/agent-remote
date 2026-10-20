import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalMediaRepository } from '@daemon/local/media/repository.js';
import { AttachmentService } from '@daemon/attachments/service.js';
import { localFixture } from '../local/local-runtime.js';
import { LocalOperation, type AttachmentDescriptor, HttpStatus } from '@protocol';

export const syntheticBytes = Buffer.from('Synthetic local/relay attachment');

export async function attachmentLocalRelay(paired = false) {
  const runtime = localFixture();
  const directory = await mkdtemp(join(tmpdir(), 'attachment-local-relay-'));

  const media = new LocalMediaRepository({
    directory: join(directory, 'media'),
    database: runtime.database,
    ownerId: runtime.principal.ownerId,
    session: (id) => runtime.monitor.session(id),
    current: (principal) => runtime.grants.current(principal),
  });

  const relayed = new Map<string, { descriptor: AttachmentDescriptor; bytes: Uint8Array }>();
  const remoteId = randomUUID();
  let network = 0;
  let offline = false;
  let missingHead = false;
  let oversized = false;
  let wrongMetadata = false;

  const fetcher: typeof fetch = async (url, init = {}) => {
    network++;

    if (offline) {
      throw new Error('Synthetic relay outage');
    }

    if (init.method === 'POST') {
      if (oversized) {
        return new Response('0'.repeat(4097), { headers: { 'content-length': '4097' } });
      }

      const content = new Uint8Array(await new Response(init.body).arrayBuffer());
      const headers = new Headers(init.headers);
      const { createHash } = await import('node:crypto');

      const descriptor: AttachmentDescriptor = {
        id: missingHead ? randomUUID() : remoteId,
        name: wrongMetadata ? 'changed-name.txt' : decodeURIComponent(headers.get('x-file-name')!),
        mimeType: headers.get('content-type')!,
        byteLength: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        kind: 'file',
      };

      relayed.set(descriptor.id, { descriptor, bytes: content });

      return Response.json(descriptor);
    }

    const id = new URL(String(url)).pathname.split('/').at(-1)!;
    const found = relayed.get(id);

    if (!found || (missingHead && init.method === 'HEAD')) {
      return new Response(null, { status: HttpStatus.NotFound });
    }

    return new Response(init.method === 'HEAD' ? null : new Uint8Array(found.bytes));
  };

  const service = new AttachmentService({
    directory,
    local: media,
    fetch: fetcher,
    ...(paired ? { relayUrl: 'http://127.0.0.1:3000', deviceToken: 'synthetic-device' } : {}),
  });

  const upload = async () => {
    const start = (await media.execute(runtime.principal, {
      operation: LocalOperation.MediaBegin,
      sessionId: runtime.session.id,
      generation: runtime.session.generation,
      uploadId: randomUUID(),
      name: 'synthetic.txt',
      mimeType: 'text/plain',
      byteLength: syntheticBytes.length,
    })) as { transferId: string };

    await media.execute(runtime.principal, {
      operation: LocalOperation.MediaChunk,
      transferId: start.transferId,
      offset: 0,
      data: syntheticBytes.toString('base64'),
    });

    return (await media.execute(runtime.principal, {
      operation: LocalOperation.MediaFinish,
      transferId: start.transferId,
    })) as AttachmentDescriptor;
  };

  return {
    ...runtime,
    media,
    service,
    directory,
    relayed,
    upload,
    remoteId,
    network: () => network,
    offline: () => {
      offline = true;
    },
    missingHead: () => {
      missingHead = true;
    },
    wrongMetadata: () => {
      wrongMetadata = true;
    },
    oversized: () => {
      oversized = true;
    },
    cleanup: async () => {
      await service.close();
      await media.close();
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
