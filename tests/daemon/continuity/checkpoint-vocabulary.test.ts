import { CheckpointCoverage } from '@protocol';
import { expect, it } from 'vitest';
import * as checkpoint from '@daemon/domain/continuity/checkpoint.js';
import { checkpointCoverage } from '@daemon/continuity/context/values.js';

it('reuses the protocol checkpoint coverage instead of a daemon copy', () => {
  const complete = { missingMessageIds: [], missingAttachmentCount: 0, stoppedAtPageLimit: false };

  expect(Object.keys(checkpoint)).not.toContain('CheckpointCoverage');
  expect(checkpointCoverage(complete)).toBe(CheckpointCoverage.Complete);
  expect(checkpointCoverage({ ...complete, stoppedAtPageLimit: true })).toBe(CheckpointCoverage.RecentWindow);
});
