import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCode, LocalOperation } from '../packages/protocol/src/index.js';
import { setup, closeFixtures, command, save } from './helpers/local-queue.js';

afterEach(closeFixtures);

it.each([false, true])('releases a definitively rejected prompt barrier (direct=%s)', async (direct) => {
  const f = setup();
  const adapter = f.controller.options.adapters.resolve(f.session.target);

  vi.spyOn(adapter, 'sendPrompt').mockRejectedValueOnce(new Error(ErrorCode.CAPABILITY_UNAVAILABLE));

  if (direct) {
    await f.controller.execute(f.principal, {
      operation: LocalOperation.Send,
      command: command(f, 'rejected'),
    });

    await save(f, 0, [command(f, 'next')]);
  } else {
    await save(f, 0, [command(f, 'rejected'), command(f, 'next')]);
  }

  await expect.poll(() => f.delivered).toEqual(['next']);
});
