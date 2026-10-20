import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextCheckpointManager } from '@daemon/continuity/context/checkpoint.js';
import { checkpointRoot, checkpointSource, cleanCheckpointRoots } from '../../helpers/checkpoint-fixtures.js';

const source = () => checkpointSource().source;

afterEach(cleanCheckpointRoots);

describe('bounded checkpoint collection', () => {
  it('marks a missing selected attachment explicitly', async () => {
    const directory = await checkpointRoot('checkpoint-large-');
    const history = source();

    history.page = async () => ({
      messages: [
        {
          id: 'm1',
          role: 'user',
          visible: true,
          text: 'see file',
          attachments: [{ id: 'gone', path: 'gone.bin' }],
        },
      ],
      nextAnchor: null,
      hasMore: false,
    });

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(history, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: ['gone'],
      constraints: [],
    });

    const saved = JSON.parse(await readFile(join(directory, `draft-${draft.id}.json`), 'utf8'));

    expect(draft.coverage).toBe('recent_window');

    expect(saved.body.messages[0].attachments[0]).toMatchObject({
      id: 'gone',
      hash: null,
      status: 'missing',
    });
  });

  it('detects a deleted blob after approval and restart', async () => {
    const directory = await checkpointRoot('checkpoint-large-');
    const attachmentRoot = join(directory, 'source');

    await mkdir(attachmentRoot, { mode: 0o700 });
    await writeFile(join(attachmentRoot, 'a.bin'), 'attachment');
    const history = source();

    history.page = async () => ({
      messages: [
        { id: 'm1', role: 'user', visible: true, text: 'file', attachments: [{ id: 'a1', path: 'a.bin' }] },
      ],
      nextAnchor: null,
      hasMore: false,
    });

    history.readAttachment = async ({ path }) => new Uint8Array(await readFile(join(attachmentRoot, path)));
    const manager = new ContextCheckpointManager({ directory: join(directory, 'store'), ownerId: 'owner-a' });

    const draft = await manager.prepareCheckpoint(history, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: ['a1'],
      constraints: [],
    });

    const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, history);

    const manifest = JSON.parse(
      await readFile(join(directory, 'store', `checkpoint-${draft.id}.json`), 'utf8'),
    );

    await unlink(
      join(directory, 'store', 'attachments', `${manifest.body.messages[0].attachments[0].hash}.blob`),
    );

    const restarted = new ContextCheckpointManager({
      directory: join(directory, 'store'),
      ownerId: 'owner-a',
    });

    await expect(restarted.readCheckpoint(draft.id, summary.digest, history)).rejects.toThrow(
      'CHECKPOINT_ATTACHMENT_MISSING',
    );
  });

  it('caps page count for a synthetic huge history and exposes gaps', async () => {
    const directory = await checkpointRoot('checkpoint-large-');
    const history = source();
    let calls = 0;

    history.page = async ({ anchor, limit }) => {
      calls++;
      expect(limit).toBe(2);

      return {
        messages: anchor ? [] : [{ id: 'recent', role: 'user', visible: true, text: 'recent' }],
        nextAnchor: anchor ? `${anchor}-older` : 'older-cursor',
        hasMore: true,
      };
    };

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a', pageSize: 2, maxPages: 3 });

    const draft = await manager.prepareCheckpoint(history, {
      selectedMessageIds: ['recent', 'old'],
      selectedAttachmentIds: [],
      constraints: [],
    });

    expect(calls).toBeLessThanOrEqual(3);
    expect(draft.missingMessageIds).toContain('old');
    expect(draft.coverage).toBe('recent_window');
  });

  it('invalidates the preview when the working tree changes during paging', async () => {
    const directory = await checkpointRoot('checkpoint-large-');
    const history = source();
    let reads = 0;

    history.captureFence = async () => ({
      ownerId: 'owner-a',
      deviceId: 'device-a',
      executionId: 'execution-a',
      generation: 'generation-a',
      historyWatermark: 'watermark-a',
      repositoryRevision: 'abc123',
      workingTree: reads ? 'file edited' : 'clean',
    });

    history.page = async () => {
      reads++;

      return {
        messages: [{ id: 'm1', role: 'user', visible: true, text: 'task' }],
        nextAnchor: null,
        hasMore: false,
      };
    };

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    await expect(
      manager.prepareCheckpoint(history, {
        selectedMessageIds: ['m1'],
        selectedAttachmentIds: [],
        constraints: [],
      }),
    ).rejects.toThrow('CHECKPOINT_SOURCE_CHANGED');
  });

  it('truncates oversized selected text at the byte budget and marks coverage', async () => {
    const directory = await checkpointRoot('checkpoint-large-');
    const history = source();

    history.page = async () => ({
      messages: [{ id: 'm1', role: 'user', visible: true, text: 'x'.repeat(20_000) }],
      nextAnchor: null,
      hasMore: false,
    });

    const manager = new ContextCheckpointManager({ directory, ownerId: 'owner-a', maxBytes: 256 });

    const draft = await manager.prepareCheckpoint(history, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: [],
      constraints: [],
    });

    expect(draft.byteCount).toBeLessThanOrEqual(256);
    expect(draft.textTruncated).toBe(true);
    expect(draft.coverage).toBe('recent_window');
  });
});
