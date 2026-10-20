import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CheckpointMessage, CheckpointSource, SourceFence } from '@daemon/continuity/context/types.js';

const roots: string[] = [];

export async function checkpointRoot(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));

  roots.push(path);

  return path;
}

export async function cleanCheckpointRoots() {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

export function checkpointSource(messages: CheckpointMessage[] = []) {
  let fence: SourceFence = {
    ownerId: 'owner-a',
    deviceId: 'device-a',
    executionId: 'execution-a',
    generation: 'generation-a',
    historyWatermark: 'watermark-a',
    repositoryRevision: 'abc123',
    workingTree: 'clean',
  };

  const source: CheckpointSource = {
    captureFence: async () => ({ ...fence }),
    page: async ({ anchor, limit }) => {
      const end = anchor ? Number(anchor) : messages.length;
      const start = Math.max(0, end - limit);

      return { messages: messages.slice(start, end), nextAnchor: String(start), hasMore: end > limit };
    },
    readAttachment: async () => {
      throw new Error('MISSING');
    },
  };

  return {
    source,
    change: (value: Partial<SourceFence>) => {
      fence = { ...fence, ...value };
    },
  };
}
