import { expect, it, vi } from 'vitest';
import { CodedError, ErrorCode, FrameType, type ServerFrame } from '@protocol';
import { RelayFrameRouter } from '@daemon/runtime/relay-frame-router.js';

function harness(page: () => Promise<unknown> = async () => ({ messages: [], before: null, after: null })) {
  const deps = {
    relay: { send: vi.fn((_frame: { type: string }) => true) },
    profileRelay: { receive: vi.fn(async () => {}) },
    readers: { page: vi.fn(page), has: vi.fn(() => false), registerLazy: vi.fn() },
    store: { nativeSession: vi.fn(() => undefined) },
    replay: { acknowledge: vi.fn() },
    monitor: {
      select: vi.fn(),
      snapshot: vi.fn(() => ({ sessions: [] })),
      sessionPage: vi.fn(() => ({ sessions: [{ id: 's1' }], nextCursor: 'next', hasMore: true })),
      readSubagentHistory: vi.fn(page),
      hasSubagentHistory: vi.fn(() => false),
    },
    skills: {
      list: vi.fn(async (sessionId: string, generation: string) => ({
        sessionId,
        generation,
        supported: true,
        truncated: false,
        skills: [],
      })),
    },
    adapters: { list: vi.fn(() => []) },
    dispatcher: { dispatch: vi.fn(async () => ({ commandId: 'c1', sessionId: 's1' })) },
  };

  return { deps, router: new RelayFrameRouter(deps as never) };
}

const frame = (value: Record<string, unknown>) => value as unknown as ServerFrame;

it('routes profile frames to the profile relay', async () => {
  const { deps, router } = harness();

  await router.route(frame({ type: FrameType.ProfilesRequest }));
  await router.route(frame({ type: FrameType.ProfilesCancel }));

  expect(deps.profileRelay.receive).toHaveBeenCalledTimes(2);
});

it('streams history items and completes the request', async () => {
  const { deps, router } = harness(async () => ({ messages: ['m1', 'm2'], before: 'b', after: 'a' }));

  await router.route(frame({ type: FrameType.HistoryRead, requestId: 'r', sessionId: 's', generation: 'g' }));

  expect(deps.relay.send.mock.calls.map(([sent]) => sent.type)).toEqual([
    FrameType.HistoryItem,
    FrameType.HistoryItem,
    FrameType.HistoryDone,
  ]);

  expect(deps.relay.send).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: 'r', before: 'b', after: 'a' }),
  );
});

it('routes child history through the registered child reader, never the parent transcript reader', async () => {
  const { deps, router } = harness(async () => ({
    messages: ['child-message'],
    before: 'older',
    after: null,
  }));

  deps.monitor.hasSubagentHistory.mockReturnValue(true);

  await router.route(
    frame({
      type: FrameType.HistoryRead,
      requestId: 'child-read',
      sessionId: 's',
      generation: 'g',
      agentId: 'child',
    }),
  );

  expect(deps.readers.page).not.toHaveBeenCalled();

  expect(deps.monitor.readSubagentHistory).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 's', generation: 'g', agentId: 'child' }),
  );

  expect(deps.relay.send.mock.calls.map(([sent]) => sent.type)).toEqual([
    FrameType.HistoryItem,
    FrameType.HistoryDone,
  ]);
});

it('keeps Claude child history on its transcript reader when no Codex reader is registered', async () => {
  const { deps, router } = harness(async () => ({ messages: ['claude-child'], before: null, after: null }));

  deps.monitor.hasSubagentHistory.mockReturnValue(false);

  await router.route(
    frame({
      type: FrameType.HistoryRead,
      requestId: 'claude-child-read',
      sessionId: 's',
      generation: 'g',
      agentId: 'claude-agent-id',
    }),
  );

  expect(deps.monitor.readSubagentHistory).not.toHaveBeenCalled();

  expect(deps.readers.page).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 's', generation: 'g', agentId: 'claude-agent-id' }),
  );
});

it('reports a failed history read', async () => {
  const { deps, router } = harness(async () => {
    throw new Error('x');
  });

  await router.route(frame({ type: FrameType.HistoryRead, requestId: 'r', sessionId: 's', generation: 'g' }));

  expect(deps.relay.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: FrameType.HistoryDone, error: ErrorCode.HISTORY_RELOAD_FAILED }),
  );
});

it('tells a subagent view its transcript is missing and keeps the generic failure for the session', async () => {
  const missing = async () => {
    throw new CodedError(ErrorCode.TRANSCRIPT_UNAVAILABLE);
  };

  const subagent = harness(missing);

  await subagent.router.route(
    frame({ type: FrameType.HistoryRead, requestId: 'r', sessionId: 's', generation: 'g', agentId: 'a1' }),
  );

  expect(subagent.deps.relay.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: FrameType.HistoryDone, error: ErrorCode.TRANSCRIPT_UNAVAILABLE }),
  );

  const session = harness(missing);

  await session.router.route(
    frame({ type: FrameType.HistoryRead, requestId: 'r', sessionId: 's', generation: 'g' }),
  );

  expect(session.deps.relay.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: FrameType.HistoryDone, error: ErrorCode.HISTORY_RELOAD_FAILED }),
  );
});

it('acknowledges replay cursors', async () => {
  const { deps, router } = harness();

  await router.route(frame({ type: FrameType.Ack, cursor: 7 }));

  expect(deps.replay.acknowledge).toHaveBeenCalledWith(7);
});

it('selects sessions and ignores selection failures', async () => {
  const { deps, router } = harness();

  deps.monitor.select.mockImplementationOnce(() => {
    throw new Error('stale');
  });

  await router.route(frame({ type: FrameType.Select, sessionId: 's1' }));
  await router.route(frame({ type: FrameType.Select, sessionId: 's2' }));

  expect(deps.monitor.select).toHaveBeenCalledWith('s1');
  expect(deps.monitor.select).toHaveBeenCalledWith('s2');
});

it('dispatches commands and sends snapshot then result when a session is involved', async () => {
  const { deps, router } = harness();

  await router.route(frame({ type: FrameType.Command, command: { id: 'c1' } }));

  expect(deps.dispatcher.dispatch).toHaveBeenCalledWith({ id: 'c1' });

  expect(deps.relay.send.mock.calls.map(([sent]) => sent.type)).toEqual([
    FrameType.Snapshot,
    FrameType.CommandResult,
  ]);
});

it('sends only the result for commands without a session', async () => {
  const { deps, router } = harness();

  deps.dispatcher.dispatch.mockResolvedValueOnce({ commandId: 'c2' } as never);
  await router.route(frame({ type: FrameType.Command, command: { id: 'c2' } }));

  expect(deps.relay.send.mock.calls.map(([sent]) => sent.type)).toEqual([FrameType.CommandResult]);
});

it('answers a model switch with the choice it took, or with the code of the refusal', async () => {
  const { deps } = harness();
  const choice = { model: 'synthetic-model' };

  const switches = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE));

  const router = new RelayFrameRouter({ ...deps, models: { switch: switches } } as never);

  await router.route(frame({ type: FrameType.SessionModel, requestId: 'r1', sessionId: 's', choice }));
  await router.route(frame({ type: FrameType.SessionModel, requestId: 'r2', sessionId: 's', choice }));

  expect(deps.relay.send.mock.calls.map(([sent]) => sent)).toEqual([
    { type: FrameType.SessionModelResult, requestId: 'r1', reply: { ok: true, choice } },
    {
      type: FrameType.SessionModelResult,
      requestId: 'r2',
      reply: { ok: false, code: ErrorCode.CAPABILITY_UNAVAILABLE },
    },
  ]);
});

it('routes bounded session pages and generation-bound skills requests', async () => {
  const { deps, router } = harness();
  const skills = { sessionId: 's1', generation: 'g1', supported: true, truncated: false, skills: [] };

  await router.route(
    frame({ type: FrameType.SessionListRead, requestId: 'r1', provider: 'Claude', cursor: 'old' }),
  );

  await router.route(
    frame({ type: FrameType.SkillsRequest, requestId: 'r2', sessionId: 's1', generation: 'g1' }),
  );

  expect(deps.monitor.sessionPage).toHaveBeenCalledWith('Claude', 'old');
  expect(deps.skills.list).toHaveBeenCalledWith('s1', 'g1');

  expect(deps.relay.send.mock.calls.map(([sent]) => sent)).toEqual([
    {
      type: FrameType.SessionListResult,
      requestId: 'r1',
      reply: { ok: true, page: { sessions: [{ id: 's1' }], nextCursor: 'next' } },
    },
    { type: FrameType.SkillsResult, requestId: 'r2', reply: { ok: true, skills } },
  ]);
});

it('returns a bounded error reply when a session page cursor is invalid', async () => {
  const { deps, router } = harness();

  deps.monitor.sessionPage.mockImplementationOnce(() => {
    throw new CodedError(ErrorCode.STALE_SESSION);
  });

  await router.route(
    frame({ type: FrameType.SessionListRead, requestId: 'r1', provider: 'Claude', cursor: 'bad' }),
  );

  expect(deps.relay.send).toHaveBeenCalledWith({
    type: FrameType.SessionListResult,
    requestId: 'r1',
    reply: { ok: false, code: ErrorCode.STALE_SESSION },
  });
});

it('returns stale-generation failures for skills without leaking the native error', async () => {
  const { deps, router } = harness();

  deps.skills.list.mockRejectedValueOnce(new CodedError(ErrorCode.STALE_SESSION));

  await router.route(
    frame({ type: FrameType.SkillsRequest, requestId: 'r1', sessionId: 's1', generation: 'stale' }),
  );

  expect(deps.relay.send).toHaveBeenCalledWith({
    type: FrameType.SkillsResult,
    requestId: 'r1',
    reply: { ok: false, code: ErrorCode.STALE_SESSION },
  });
});
