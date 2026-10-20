import { afterEach, expect, it } from 'vitest';
import { CommandStatus, LocalOperation, PromptDelivery } from '@protocol';
import { ClaudeHookEvent } from '@daemon/domain/claude.js';
import { RuntimeEvent } from '@daemon/domain/runtime.js';
import { setup, closeFixtures, restartQueue, command, save, hook } from '../../../helpers/local-queue.js';

afterEach(closeFixtures);

it('preserves drafts with CAS and rejects a stale writer', async () => {
  const f = setup();

  const action = {
    operation: LocalOperation.DraftSave,
    sessionId: f.session.id,
    generation: f.session.generation,
    revision: 0,
    text: 'durable synthetic draft',
    attachments: [],
  };

  expect(await f.persistence.execute(f.principal, action)).toEqual({
    revision: 1,
    text: action.text,
    attachments: [],
  });

  await expect(f.persistence.execute(f.principal, action)).rejects.toThrow('LOCAL_REVISION_CONFLICT');

  expect(
    await f.persistence.execute(f.principal, { operation: LocalOperation.DraftGet, sessionId: f.session.id }),
  ).toEqual({ revision: 1, text: action.text, attachments: [] });
});

it('persists acknowledged queue edits and rejects a stale revision', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);
  expect(await save(f, 0, [command(f, 'first')])).toEqual({ revision: 1, intents: [command(f, 'first')] });
  await expect(save(f, 0, [])).rejects.toThrow('LOCAL_REVISION_CONFLICT');
  const edited = command(f, 'first');

  edited.action.text = 'edited';
  expect(await save(f, 1, [edited])).toEqual({ revision: 2, intents: [edited] });
});

it.each([false, true])('holds next prompt until a turn ends (direct=%s)', async (direct) => {
  const f = setup();

  if (direct) {
    f.persistence.claim(command(f, 'first'), f.principal);
    await f.controller.options.dispatcher.dispatch(f.store.localCommand(command(f, 'first')));
    await save(f, 0, [command(f, 'second')]);
  } else {
    await save(f, 0, [command(f, 'first'), command(f, 'second')]);
  }

  expect(f.delivered).toEqual(direct ? ['first'] : []);
  await expect.poll(() => f.delivered).toEqual(['first']);
  f.monitor.emit(RuntimeEvent.Snapshot);
  await new Promise(setImmediate);
  expect(f.delivered).toEqual(['first']);
  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await new Promise(setImmediate);
  hook(f, ClaudeHookEvent.Stop);
  await expect.poll(() => f.delivered).toEqual(['first', 'second']);
});

it('restarts with durable unsent intent but never replays a prepared unknown command', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await save(f, 0, [command(f, 'unknown'), command(f, 'later')]);
  f.store.localCommand(command(f, 'unknown'));
  const restored = await restartQueue(f);

  hook(f, ClaudeHookEvent.Stop);
  await new Promise(setImmediate);
  expect(f.delivered).toEqual([]);

  expect(f.store.receipt('unknown')).toMatchObject({
    status: CommandStatus.Unknown,
    code: 'UNFINISHED_DISPATCH',
  });

  expect(
    await restored.execute(f.principal, { operation: LocalOperation.QueueGet, sessionId: f.session.id }),
  ).toMatchObject({ intents: [command(f, 'unknown'), command(f, 'later')] });
});

it('revalidates a revoked grant before delivering saved work', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await save(f, 0, [command(f, 'revoked')]);
  f.grants.revoke(f.principal.clientId);
  hook(f, ClaudeHookEvent.Stop);
  await new Promise(setImmediate);
  expect(f.delivered).toEqual([]);
});

it('claims send-now before async dispatch and prevents edits or removal', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await save(f, 0, [command(f, 'send-now')]);
  const immediate = command(f, 'send-now');

  immediate.action.delivery = PromptDelivery.Immediate;
  f.persistence.claim(immediate, f.principal);
  await expect(save(f, 1, [])).rejects.toThrow('LOCAL_REVISION_CONFLICT');
  const changed = command(f, 'send-now');

  changed.action.text = 'changed';
  await expect(save(f, 1, [changed])).rejects.toThrow('LOCAL_REVISION_CONFLICT');

  expect(await f.controller.options.dispatcher.dispatch(f.store.localCommand(immediate))).toMatchObject({
    status: CommandStatus.Dispatched,
  });

  f.persistence.queue.kick();
  await expect.poll(() => f.delivered).toEqual(['send-now']);
});

it('clears only a matching draft atomically with a newly acknowledged queue intent', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);

  const draft = {
    operation: LocalOperation.DraftSave,
    sessionId: f.session.id,
    generation: f.session.generation,
    revision: 0,
    text: 'queued',
    attachments: [],
  };

  await f.persistence.execute(f.principal, draft);
  const queued = command(f, 'draft-command');

  queued.action.text = draft.text;
  await save(f, 0, [queued]);

  expect(
    await f.persistence.execute(f.principal, { operation: LocalOperation.DraftGet, sessionId: f.session.id }),
  ).toEqual({ revision: 2, text: '', attachments: [] });

  await f.persistence.execute(f.principal, { ...draft, revision: 2, text: 'concurrently edited draft' });
  await save(f, 1, [queued, command(f, 'different')]);

  expect(
    await f.persistence.execute(f.principal, { operation: LocalOperation.DraftGet, sessionId: f.session.id }),
  ).toMatchObject({ revision: 3, text: 'concurrently edited draft' });
});

it('rejects duplicate IDs, other sessions, foreign targets and stale generations before accepting queue data', async () => {
  const f = setup();
  const valid = command(f, 'valid');

  await expect(save(f, 0, [valid, valid])).rejects.toThrow('COMMAND_ID_REUSED');

  for (const changed of [
    { ...valid, sessionId: 'other-session' },
    { ...valid, generation: 'old-generation' },
    { ...valid, target: { ...valid.target, deviceId: 'other-device' } },
  ]) {
    await expect(save(f, 0, [changed])).rejects.toThrow('STALE_SESSION');
  }

  expect(f.delivered).toEqual([]);
});

it('restores a saved unsent queue after the engine restarts and drops stale generations', async () => {
  const f = setup();

  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await save(f, 0, [command(f, 'restored')]);
  await restartQueue(f);
  hook(f, ClaudeHookEvent.Stop);
  await expect.poll(() => f.delivered).toEqual(['restored']);
  hook(f, ClaudeHookEvent.UserPromptSubmit);
  await new Promise(setImmediate);

  const current = (await f.persistence.execute(f.principal, {
    operation: LocalOperation.QueueGet,
    sessionId: f.session.id,
  })) as { revision: number };

  await save(f, current.revision, [command(f, 'stale')]);

  f.monitor.ingestHook(
    { hook_event_name: ClaudeHookEvent.SessionStart, session_id: 'synthetic-session' },
    'managed-test',
  );

  await new Promise(setImmediate);
  expect(f.delivered).toEqual(['restored']);
});
