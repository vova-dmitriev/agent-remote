import { mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextCheckpointManager } from '../../../apps/daemon/src/continuity/context/checkpoint.js';
import { checkpointRoot, checkpointSource, cleanCheckpointRoots } from '../../helpers/checkpoint-fixtures.js';

const source = () => {
  const { source: adapter, change } = checkpointSource([
    { id: 'm1', role: 'user', visible: true, text: 'task' },
  ]);

  return { adapter, change };
};

afterEach(cleanCheckpointRoots);

describe('checkpoint storage and source fences', () => {
  it('rejects finalize after any captured source boundary changes', async () => {
    const directory = await checkpointRoot('checkpoint-security-');
    const { adapter, change } = source();
    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(adapter, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: [],
      constraints: [],
    });

    change({ deviceId: 'device-b' });

    await expect(
      manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, adapter),
    ).rejects.toThrow('CHECKPOINT_SOURCE_CHANGED');
  });

  it('rejects checkpoint use when repository state changes after approval', async () => {
    const directory = await checkpointRoot('checkpoint-security-');
    const { adapter, change } = source();
    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(adapter, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: [],
      constraints: [],
    });

    const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, adapter);

    change({ workingTree: 'same file edited' });

    await expect(manager.readCheckpoint(draft.id, summary.digest, adapter)).rejects.toThrow(
      'CHECKPOINT_SOURCE_CHANGED',
    );
  });

  it('rejects a symlinked storage root without writing through it', async () => {
    const directory = await checkpointRoot('checkpoint-security-');
    const target = join(directory, 'target');
    const link = join(directory, 'store-link');

    await mkdir(target, { mode: 0o700 });
    await symlink(target, link, 'dir');
    const manager = new ContextCheckpointManager({ directory: link, ownerId: 'owner-a' });
    const { adapter } = source();

    await expect(
      manager.prepareCheckpoint(adapter, {
        selectedMessageIds: ['m1'],
        selectedAttachmentIds: [],
        constraints: [],
      }),
    ).rejects.toThrow('CHECKPOINT_STORAGE_UNSAFE');

    expect(await readFile(join(target, 'sentinel')).catch(() => null)).toBeNull();
  });

  it('rejects symlinked manifests and blobs instead of following them', async () => {
    const directory = await checkpointRoot('checkpoint-security-');
    const store = join(directory, 'store');
    const attachmentSource = join(directory, 'source.bin');

    await writeFile(attachmentSource, 'visible attachment');
    const { adapter } = source();

    adapter.page = async () => ({
      messages: [
        {
          id: 'm1',
          role: 'user',
          visible: true,
          text: 'task',
          attachments: [{ id: 'a1', path: attachmentSource }],
        },
      ],
      nextAnchor: null,
      hasMore: false,
    });

    adapter.readAttachment = async ({ path }, maxBytes) => {
      const bytes = new Uint8Array(await readFile(path));

      if (bytes.byteLength > maxBytes) {
        throw new Error('TOO_LARGE');
      }

      return bytes;
    };

    const manager = new ContextCheckpointManager({ directory: store, ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(adapter, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: ['a1'],
      constraints: [],
    });

    const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, adapter);
    const checkpointPath = join(store, `checkpoint-${draft.id}.json`);
    const manifest = JSON.parse(await readFile(checkpointPath, 'utf8'));
    const blobPath = join(store, 'attachments', `${manifest.body.messages[0].attachments[0].hash}.blob`);
    const external = join(directory, 'external');

    await rename(checkpointPath, `${checkpointPath}.saved`);
    await writeFile(external, await readFile(`${checkpointPath}.saved`));
    await symlink(external, checkpointPath);

    await expect(manager.readCheckpoint(draft.id, summary.digest, adapter)).rejects.toThrow(
      'CHECKPOINT_STORAGE_UNSAFE',
    );

    await unlink(checkpointPath);
    await rename(`${checkpointPath}.saved`, checkpointPath);
    await unlink(blobPath);
    await symlink(attachmentSource, blobPath);

    await expect(manager.readCheckpoint(draft.id, summary.digest, adapter)).rejects.toThrow(
      'CHECKPOINT_STORAGE_UNSAFE',
    );
  });

  it('does not include unselected attachments or silently truncate approved summaries', async () => {
    const directory = await checkpointRoot('checkpoint-security-');
    const { adapter } = source();

    adapter.page = async () => ({
      messages: [
        { id: 'm1', role: 'user', visible: true, text: 'task', attachments: [{ id: 'a1', path: 'unused' }] },
      ],
      nextAnchor: null,
      hasMore: false,
    });

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a', maxBytes: 256 });

    const draft = await manager.prepareCheckpoint(adapter, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: [],
      constraints: [],
    });

    const saved = JSON.parse(await readFile(join(directory, `draft-${draft.id}.json`), 'utf8'));

    expect(saved.body.messages[0].attachments).toEqual([]);

    await expect(
      manager.finalizeCheckpoint(draft.id, 'é'.repeat(200), { kind: 'manual' }, draft.digest, adapter),
    ).rejects.toThrow('CHECKPOINT_SIZE_LIMIT');
  });
});
