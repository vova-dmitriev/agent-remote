import type { Locator } from '@playwright/test';

const STABLE_FRAMES = 30;

// Resolves once the scroller has not moved for STABLE_FRAMES consecutive animation frames, so a
// smooth jump and the virtualizer's measurement corrections have finished before the test mutates the list.
export async function scrollSettled(scroller: Locator) {
  await scroller.evaluate(
    (node, frames) =>
      new Promise<void>((resolve) => {
        let last = node.scrollTop;
        let stable = 0;

        const tick = () => {
          stable = node.scrollTop === last ? stable + 1 : 0;
          last = node.scrollTop;
          if (stable >= frames) resolve();
          else requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      }),
    STABLE_FRAMES,
  );
}
