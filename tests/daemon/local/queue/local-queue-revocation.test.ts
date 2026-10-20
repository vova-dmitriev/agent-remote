import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CommandStatus, ErrorCode, LocalOperation } from '@protocol';
import { setup, closeFixtures, command, save } from '../../../helpers/local-queue.js';

afterEach(closeFixtures);

it('reconciles a terminal rejected entry after revocation so another approved client can queue work', async () => {
  const f = setup();
  const clientId = randomUUID();

  try {
    f.grants.connect(f.principal.origin, clientId);
  } catch {}

  f.grants.approve(clientId, f.principal.origin);
  const other = f.grants.connect(f.principal.origin, clientId);
  const adapter = f.controller.options.adapters.resolve(f.session.target);

  vi.spyOn(adapter, 'sendPrompt').mockImplementationOnce(async () => {
    f.grants.revoke(f.principal.clientId);
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  });

  await save(f, 0, [command(f, 'rejected')]);
  await expect.poll(() => f.store.receipt('rejected').status).toBe(CommandStatus.Rejected);
  await new Promise(setImmediate);

  const queue = (await f.persistence.execute(other, {
    operation: LocalOperation.QueueGet,
    sessionId: f.session.id,
  })) as { revision: number; intents: ReturnType<typeof command>[] };

  await f.persistence.execute(other, {
    operation: LocalOperation.QueueSave,
    sessionId: f.session.id,
    generation: f.session.generation,
    revision: queue.revision,
    intents: [...queue.intents, command(f, 'next')],
  });

  await expect.poll(() => f.delivered).toEqual(['next']);
});
