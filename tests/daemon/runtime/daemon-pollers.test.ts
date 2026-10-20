import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeRestartState, SessionStatus, TargetKind, ConnectorId } from '@protocol';
import { SourcePoller } from '../../../apps/daemon/src/runtime/source-poller.js';
import { NativeRestartPoller } from '../../../apps/daemon/src/runtime/native-restart-poller.js';
import {
  NATIVE_PROCESS_POLL_INTERVAL_MS,
  SESSION_ACTIVITY_POLL_INTERVAL_MS,
  SOURCE_POLL_INTERVAL_MS,
} from '../../../apps/daemon/src/runtime-timings.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function sourceHarness(online = true) {
  const deps = {
    monitor: { selectedId: undefined, session: vi.fn() },
    adapters: {},
    store: { prune: vi.fn() },
    readers: { refreshActivity: vi.fn(async () => {}), entries: vi.fn(() => []) },
    desktopBridge: { request: vi.fn() },
    desktopBindings: new Map(),
    inputEnabled: true,
    online: () => online,
    stopping: () => false,
    snapshot: vi.fn(),
    flush: vi.fn(),
    retryAttachmentExports: vi.fn(async () => {}),
  };

  return { deps, poller: new SourcePoller(deps as never) };
}

it('source poller refreshes activity on start and polls sources on its interval', async () => {
  const { deps, poller } = sourceHarness();

  poller.start();
  expect(deps.readers.refreshActivity).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(SOURCE_POLL_INTERVAL_MS);
  expect(deps.store.prune).toHaveBeenCalledTimes(1);
  expect(deps.flush).toHaveBeenCalledTimes(1);
  expect(deps.retryAttachmentExports).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(SESSION_ACTIVITY_POLL_INTERVAL_MS);
  expect(deps.readers.refreshActivity.mock.calls.length).toBeGreaterThan(1);

  poller.stop();
  await poller.drain();
});

it('source poller stops polling and drains in-flight work', async () => {
  const { deps, poller } = sourceHarness();

  poller.start();
  await vi.advanceTimersByTimeAsync(SOURCE_POLL_INTERVAL_MS);
  poller.stop();
  await poller.drain();

  const pruned = deps.store.prune.mock.calls.length;
  const activity = deps.readers.refreshActivity.mock.calls.length;

  await vi.advanceTimersByTimeAsync(SOURCE_POLL_INTERVAL_MS * 3 + SESSION_ACTIVITY_POLL_INTERVAL_MS * 3);

  expect(deps.store.prune).toHaveBeenCalledTimes(pruned);
  expect(deps.readers.refreshActivity).toHaveBeenCalledTimes(activity);
});

it('source poller skips attachment retries while offline', async () => {
  const { deps, poller } = sourceHarness(false);

  poller.start();
  await vi.advanceTimersByTimeAsync(SOURCE_POLL_INTERVAL_MS);
  poller.stop();
  await poller.drain();

  expect(deps.retryAttachmentExports).not.toHaveBeenCalled();
  expect(deps.flush).toHaveBeenCalled();
});

function nativeHarness(inputEnabled = true) {
  const session = {
    id: 's1',
    generation: 'g1',
    cwd: '/work',
    claudeSessionId: 'c1',
    status: SessionStatus.Idle,
    target: { connectorId: ConnectorId.Native, kind: TargetKind.ClaudeCodeCli },
  };

  const deps = {
    monitor: { snapshot: vi.fn(() => ({ sessions: [session] })), setNativeRestartState: vi.fn() },
    nativeProcesses: { inspect: vi.fn(async () => ({ state: NativeRestartState.Available })) },
    inputEnabled,
    stopping: () => false,
  };

  return { deps, poller: new NativeRestartPoller(deps as never) };
}

it('native restart poller inspects immediately and on its interval until stopped', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  const { deps, poller } = nativeHarness();

  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.nativeProcesses.inspect).toHaveBeenCalledWith('c1', '/work');
  expect(deps.monitor.setNativeRestartState).toHaveBeenCalledWith('s1', 'g1', NativeRestartState.Available);

  await vi.advanceTimersByTimeAsync(NATIVE_PROCESS_POLL_INTERVAL_MS);
  expect(deps.nativeProcesses.inspect).toHaveBeenCalledTimes(2);

  poller.stop();
  await vi.advanceTimersByTimeAsync(NATIVE_PROCESS_POLL_INTERVAL_MS * 3);
  expect(deps.nativeProcesses.inspect).toHaveBeenCalledTimes(2);
  platform.mockRestore();
});

it('native restart poller does nothing when input is disabled', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  const { deps, poller } = nativeHarness(false);

  poller.start();
  await vi.advanceTimersByTimeAsync(NATIVE_PROCESS_POLL_INTERVAL_MS);
  poller.stop();

  expect(deps.nativeProcesses.inspect).not.toHaveBeenCalled();
  platform.mockRestore();
});
