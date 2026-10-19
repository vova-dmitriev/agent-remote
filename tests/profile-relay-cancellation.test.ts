import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { RuntimeProfileRelay } from '../apps/daemon/src/profiles/runtime/router/relay.js';
import type { RuntimeProfiles } from '../apps/daemon/src/profiles/runtime/service.js';
import type { DeviceFrame } from '@protocol';

it('cancels the caller fence before the next native effect and suppresses its reply', async () => {
  let resume!: () => void;

  const pause = new Promise<void>((resolve) => {
    resume = resolve;
  });

  let effects = 0;
  const sent: DeviceFrame[] = [];

  const service = {
    request: async (_input: unknown, current: () => boolean) => {
      await pause;

      if (current()) {
        effects++;
      }

      return { kind: 'list', data: { profiles: [] } };
    },
  } as unknown as RuntimeProfiles;

  const relay = new RuntimeProfileRelay(
    service,
    () => 'epoch-a',
    (frame) => {
      sent.push(frame);

      return true;
    },
  );

  const requestId = randomUUID();

  const running = relay.receive({
    type: 'profiles_request',
    requestId,
    epoch: 'epoch-a',
    request: { kind: 'list' },
  });

  await relay.receive({ type: 'profiles_cancel', requestId, epoch: 'epoch-a' });
  resume();
  await running;
  expect(effects).toBe(0);
  expect(sent).toEqual([]);
});
