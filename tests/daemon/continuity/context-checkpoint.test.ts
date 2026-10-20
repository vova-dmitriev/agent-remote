import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextCheckpointManager } from '@daemon/continuity/context/checkpoint.js';
import { checkpointRoot, checkpointSource, cleanCheckpointRoots } from '../../helpers/checkpoint-fixtures.js';

const fixture = () =>
  checkpointSource([
    { id: 'm1', role: 'user' as const, visible: true, text: 'Task constraints: keep the API stable.' },
    { id: 'm2', role: 'assistant' as const, visible: true, text: 'I will preserve the existing behavior.' },
    { id: 'hidden', role: 'system' as const, visible: false, text: 'wrapper' },
  ]);

afterEach(cleanCheckpointRoots);

describe('local context checkpoints', () => {
  it('pages only selected visible messages, then requires explicit manual approval', async () => {
    const directory = await checkpointRoot('checkpoint-');
    const { source } = fixture();

    const manager = new ContextCheckpointManager({
      directory,
      ownerId: 'owner-a',
      pageSize: 1,
      maxPages: 4,
    });

    const draft = await manager.prepareCheckpoint(source, {
      selectedMessageIds: ['m1', 'm2'],
      selectedAttachmentIds: [],
      constraints: ['Do not change public API.'],
    });

    expect(draft.approved).toBe(false);
    expect(draft.coverage).toBe('complete');
    const savedDraft = JSON.parse(await readFile(join(directory, `draft-${draft.id}.json`), 'utf8'));

    expect(savedDraft.body.messages.map((message: { id: string }) => message.id)).toEqual(['m1', 'm2']);

    await expect(manager.readCheckpoint(draft.id, draft.digest, source)).rejects.toThrow(
      'CHECKPOINT_NOT_APPROVED',
    );

    await expect(
      manager.finalizeCheckpoint(draft.id, 'stale preview', { kind: 'manual' }, 'bad-digest', source),
    ).rejects.toThrow('CHECKPOINT_DRAFT_TAMPERED');

    const summary = await manager.finalizeCheckpoint(
      draft.id,
      'Manual task summary.',
      { kind: 'manual' },
      draft.digest,
      source,
    );

    const restarted = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });
    const checkpoint = await restarted.readCheckpoint(draft.id, summary.digest, source);

    expect(summary.approval.kind).toBe('manual');
    expect(summary.approval).toMatchObject({ kind: 'manual', approvedAt: expect.any(Number) });
    expect(checkpoint.body.summary).toBe('Manual task summary.');
    expect(JSON.stringify(checkpoint)).not.toContain('wrapper');
  });

  it('rejects a foreign owner before reading source history', async () => {
    const directory = await checkpointRoot('checkpoint-');
    const { source } = fixture();
    const page = source.page;

    source.page = async () => {
      throw new Error('SHOULD_NOT_READ');
    };

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-b' });

    await expect(
      manager.prepareCheckpoint(source, {
        selectedMessageIds: ['m1'],
        selectedAttachmentIds: [],
        constraints: [],
      }),
    ).rejects.toThrow('CHECKPOINT_OWNER_MISMATCH');

    source.page = page;
  });

  it('invalidates a draft when the source generation changes during a page read', async () => {
    const directory = await checkpointRoot('checkpoint-');
    const { source, change } = fixture();

    source.page = async () => {
      change({ generation: 'generation-b' });

      return {
        messages: [{ id: 'm1', role: 'user', visible: true, text: 'task' }],
        nextAnchor: null,
        hasMore: false,
      };
    };

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    await expect(
      manager.prepareCheckpoint(source, {
        selectedMessageIds: ['m1'],
        selectedAttachmentIds: [],
        constraints: [],
      }),
    ).rejects.toThrow('CHECKPOINT_SOURCE_CHANGED');
  });

  it('detects tampered manifests and missing attachment blobs after restart', async () => {
    const directory = await checkpointRoot('checkpoint-');
    const attachmentRoot = join(directory, 'attachments');

    await mkdir(attachmentRoot, { mode: 0o700 });
    await writeFile(join(attachmentRoot, 'source.bin'), 'image bytes');
    const { source } = fixture();

    source.page = async () => ({
      messages: [
        {
          id: 'm1',
          role: 'user',
          visible: true,
          text: 'inspect',
          attachments: [{ id: 'a1', path: 'source.bin' }],
        },
      ],
      nextAnchor: null,
      hasMore: false,
    });

    source.readAttachment = async ({ path }) => new Uint8Array(await readFile(join(attachmentRoot, path)));
    const manager = new ContextCheckpointManager({ directory: join(directory, 'store'), ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(source, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: ['a1'],
      constraints: [],
    });

    const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, source);

    const checkpointPath = join(directory, 'store', `checkpoint-${draft.id}.json`);
    const stored = JSON.parse(await readFile(checkpointPath, 'utf8'));

    stored.body.messages[0].attachments[0].blob = '../outside';
    await writeFile(checkpointPath, JSON.stringify(stored));

    await expect(manager.readCheckpoint(draft.id, summary.digest, source)).rejects.toThrow(
      'CHECKPOINT_DIGEST_MISMATCH',
    );

    const fresh = new ContextCheckpointManager({ directory: join(directory, 'store'), ownerId: 'owner-a' });
    const ok = await fresh.readCheckpoint(draft.id, summary.digest, source).catch((error) => error);

    expect(ok.message).toBe('CHECKPOINT_DIGEST_MISMATCH');
  });
});
