import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LocalOperation } from '@protocol';
import { AttachmentService } from '../../../apps/daemon/src/attachments/service.js';
import { attachmentPrompt } from '../../../apps/daemon/src/attachments/content/input.js';
import { attachmentLocalRelay, syntheticBytes } from '../../helpers/attachment-local-relay.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function fixture(paired = false) {
  const result = await attachmentLocalRelay(paired);

  cleanups.push(result.cleanup);

  return result;
}

it('prepares a local extension upload without a relay or descriptor mutation', async () => {
  const f = await fixture();
  const descriptor = await f.upload();
  const prepared = await f.service.prepare(f.session, [descriptor]);

  expect(prepared.map((item) => item.descriptor)).toEqual([descriptor]);
  expect(await readFile(prepared[0]!.path)).toEqual(syntheticBytes);
  expect(f.network()).toBe(0);
});

it('imports paired native exports under the exact remote ID for local chunk reads', async () => {
  const f = await fixture(true);

  const descriptor = await f.service.export(f.session, 'native-export', {
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    bytes: syntheticBytes,
  });

  expect(descriptor.id).toBe(f.remoteId);

  const transfer = (await f.media.execute(f.principal, {
    operation: LocalOperation.MediaRead,
    sessionId: f.session.id,
    attachmentId: descriptor.id,
  })) as { transferId: string; descriptor: unknown };

  expect(transfer.descriptor).toEqual(descriptor);

  const chunk = await f.media.execute(f.principal, {
    operation: LocalOperation.MediaReadChunk,
    transferId: transfer.transferId,
    offset: 0,
  });

  expect(chunk).toEqual({ data: syntheticBytes.toString('base64'), done: true });
});

it('mirrors local uploads while retaining dispatch descriptors and persisting only trusted canonical history IDs', async () => {
  const f = await fixture(true);
  const descriptor = await f.upload();
  const prepared = await f.service.prepare(f.session, [descriptor]);

  expect(prepared.map((item) => item.descriptor)).toEqual([descriptor]);
  await f.service.remember(f.session, '', prepared);

  const restored = f.service.restore(f.session, {
    id: 'sent',
    role: 'user',
    text: attachmentPrompt('', prepared),
    occurredAt: 1,
  });

  expect(restored.attachments?.[0]?.id).toBe(f.remoteId);
  const canonical = restored.attachments![0]!;

  expect(f.relayed.get(canonical.id)?.bytes).toEqual(new Uint8Array(syntheticBytes));

  expect(await (await f.media.request(f.session, canonical.id))!.arrayBuffer()).toEqual(
    syntheticBytes.buffer.slice(
      syntheticBytes.byteOffset,
      syntheticBytes.byteOffset + syntheticBytes.byteLength,
    ),
  );

  expect(prepared.map((item) => item.descriptor)).toEqual([descriptor]);
  const restarted = new AttachmentService({ directory: f.directory, local: f.media });

  try {
    await restarted.ready();

    expect(
      restarted.restore(f.session, {
        id: 'sent',
        role: 'user',
        text: attachmentPrompt('', prepared),
        occurredAt: 1,
      }).attachments,
    ).toEqual([canonical]);
  } finally {
    await restarted.close();
  }
});

it('preserves local preparation during relay outage without inventing a relay-readable ID', async () => {
  const f = await fixture(true);
  const descriptor = await f.upload();

  f.offline();
  const prepared = await f.service.prepare(f.session, [descriptor]);

  await f.service.remember(f.session, '', prepared);

  const restored = f.service.restore(f.session, {
    id: 'sent',
    role: 'user',
    text: attachmentPrompt('', prepared),
    occurredAt: 1,
  });

  expect(restored.attachments).toEqual([descriptor]);
  expect(f.relayed.has(descriptor.id)).toBe(false);
  expect(await readFile(prepared[0]!.path)).toEqual(syntheticBytes);
});

it('denies an uncached remote ID without fabricating a trusted descriptor or proxying a URL', async () => {
  const f = await fixture(true);

  await expect(
    f.media.execute(f.principal, {
      operation: LocalOperation.MediaRead,
      sessionId: f.session.id,
      attachmentId: randomUUID(),
    }),
  ).rejects.toThrow('ATTACHMENT_UNAVAILABLE');

  expect(f.network()).toBe(0);
});

it('bounds relay export descriptor parsing before importing any local metadata', async () => {
  const f = await fixture(true);

  f.oversized();

  await expect(
    f.service.export(f.session, 'oversized', {
      name: 'synthetic.txt',
      mimeType: 'text/plain',
      bytes: syntheticBytes,
    }),
  ).rejects.toThrow('ATTACHMENT_TOO_LARGE');
});

it('checks relay availability for cached native exports even when the local cache still has bytes', async () => {
  const f = await fixture(true);

  const first = await f.service.export(f.session, 'same-source', {
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    bytes: syntheticBytes,
  });

  f.missingHead();

  const next = await f.service.export(f.session, 'same-source', {
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    bytes: syntheticBytes,
  });

  expect(next.id).not.toBe(first.id);
  expect(f.relayed.has(next.id)).toBe(true);
});

it('rejects changed canonical metadata instead of silently publishing an unrelated alias', async () => {
  const f = await fixture(true);
  const descriptor = await f.upload();

  f.wrongMetadata();
  await expect(f.service.prepare(f.session, [descriptor])).rejects.toThrow('ATTACHMENT_INTEGRITY_FAILED');
  expect(await f.media.request(f.session, f.remoteId)).toBeNull();
});
