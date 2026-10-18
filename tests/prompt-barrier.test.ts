import { expect, it } from 'vitest';
import { advancePromptBarrier } from '../packages/protocol/src/prompt-delivery.js';

it('holds delivery until an actual busy cycle or message progress follows the prior dispatch', () => {
  const barrier = { lastEventAt: 1000, observedBusy: false };

  expect(advancePromptBarrier({ status: 'idle', lastEventAt: 1000 }, barrier)).toBe(false);
  expect(advancePromptBarrier({ status: 'running', lastEventAt: 1000 }, barrier)).toBe(false);
  expect(advancePromptBarrier({ status: 'idle', lastEventAt: 1000 }, barrier)).toBe(true);

  expect(
    advancePromptBarrier({ status: 'idle', lastEventAt: 1001 }, { lastEventAt: 1000, observedBusy: false }),
  ).toBe(true);
});
