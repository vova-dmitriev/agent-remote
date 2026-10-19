import { expect, it, vi } from 'vitest';
import { CodedError, ErrorCode, FrameType, type ServerFrame } from '@protocol';
import { RelayFrameRouter } from '../apps/daemon/src/runtime/relay-frame-router.js';

function harness(page: () => Promise<unknown> = async () => ({ messages: [], before: null, after: null })) {
  const deps = {
    relay: { send: vi.fn((_frame: { type: string }) => true) },
    profileRelay: { receive: vi.fn(async () => {}) },
    readers: { page: vi.fn(page) },
    replay: { acknowledge: vi.fn() },
    monitor: { select: vi.fn(), snapshot: vi.fn(() => ({ sessions: [] })) },
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
