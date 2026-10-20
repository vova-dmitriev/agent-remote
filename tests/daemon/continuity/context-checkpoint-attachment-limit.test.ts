import { afterEach, describe, expect, it } from 'vitest';
import { ContextCheckpointManager } from '@daemon/continuity/context/checkpoint.js';
import { CheckpointLimits } from '@daemon/continuity/context/values.js';
import {
  checkpointRoot,
  checkpointSource,
  cleanCheckpointRoots,
} from '../../helpers/sessions/checkpoint-fixtures.js';

afterEach(cleanCheckpointRoots);

describe('checkpoint attachment size ceiling', () => {
  it('accepts the global maximum and can verify the approved blob after restart', async () => {
    const directory = await checkpointRoot('checkpoint-limit-');
    const bytes = new Uint8Array(CheckpointLimits.MaxAttachmentBytes);

    const { source } = checkpointSource([
      { id: 'm1', role: 'user', visible: true, text: 'file', attachments: [{ id: 'a1', path: 'fixture' }] },
    ]);

    source.readAttachment = async () => bytes;

    const manager = new ContextCheckpointManager({
      directory,
      ownerId: 'owner-a',
      maxAttachmentBytes: CheckpointLimits.MaxAttachmentBytes,
    });

    const draft = await manager.prepareCheckpoint(source, {
      selectedMessageIds: ['m1'],
      selectedAttachmentIds: ['a1'],
      constraints: [],
    });

    const summary = await manager.finalizeCheckpoint(draft.id, '', { kind: 'manual' }, draft.digest, source);
    const restarted = new ContextCheckpointManager({ directory, ownerId: 'owner-a' });

    await expect(restarted.readCheckpoint(draft.id, summary.digest, source)).resolves.toMatchObject({
      id: draft.id,
    });
  });

  it('rejects a configured limit above the global verification ceiling', () => {
    expect(
      () =>
        new ContextCheckpointManager({
          directory: '/unused',
          ownerId: 'owner-a',
          maxAttachmentBytes: CheckpointLimits.MaxAttachmentBytes + 1,
        }),
    ).toThrow('CHECKPOINT_LIMIT_INVALID');
  });
});
