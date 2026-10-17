import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionBroker, permissionHookOutput } from '../apps/daemon/src/commands/permission-broker.js';

const brokers: PermissionBroker[] = [];

const request = (overrides = {}) => ({
  requestId: 'request-a',
  sessionId: 'session-a',
  generation: 'generation-a',
  toolName: 'Bash',
  input: { command: 'pwd' },
  expiresAt: Date.now() + 60_000,
  ...overrides,
});

afterEach(() => {
  brokers.forEach((b) => b.close());
  brokers.length = 0;
  vi.useRealTimers();
});

function broker(options = {}) {
  const b = new PermissionBroker(options);

  brokers.push(b);

  return b;
}

describe('PermissionBroker', () => {
  it('applies one decision to one generation without changing future permissions', async () => {
    const b = broker();
    const answer = b.open(request());

    expect(b.resolve('request-a', 'other-generation', 'allow')).toBe(false);
    expect(b.resolve('request-a', 'generation-a', 'allow')).toBe(true);
    expect(b.resolve('request-a', 'generation-a', 'deny')).toBe(false);
    expect(await answer).toBe('allow');

    expect(permissionHookOutput('allow')).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });

    expect(permissionHookOutput('local')).toEqual({});
  });

  it('falls back locally after 45 seconds and rejects late answers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const b = broker();
    const answer = b.open(request());

    expect(b.pending()[0]?.expiresAt).toBe(46_000);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await answer).toBe('local');
    expect(b.resolve('request-a', 'generation-a', 'allow')).toBe(false);
  });

  it('honors an earlier deadline even if a timer has not run', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const b = broker();
    const answer = b.open(request({ expiresAt: 2_000 }));

    vi.setSystemTime(2_000);
    expect(b.resolve('request-a', 'generation-a', 'allow')).toBe(false);
    expect(await answer).toBe('local');
  });

  it('cancels only the disconnected session generation', async () => {
    const b = broker();
    const a = b.open(request());
    const other = b.open(request({ requestId: 'request-b', generation: 'generation-b' }));

    b.cancelSession('session-a', 'generation-a');
    expect(await a).toBe('local');
    expect(b.resolve('request-b', 'generation-b', 'deny')).toBe(true);
    expect(await other).toBe('deny');
  });

  it('rejects duplicate IDs and bounded-queue overflow without replacing live requests', async () => {
    const b = broker({ maxPending: 1 });
    const answer = b.open(request());

    await expect(b.open(request())).rejects.toThrow('DUPLICATE_REQUEST');
    await expect(b.open(request({ requestId: 'request-b' }))).rejects.toThrow('PERMISSION_QUEUE_FULL');
    b.close();
    expect(await answer).toBe('local');
  });

  it('returns isolated request previews and ignores unsupported decisions', async () => {
    const b = broker();
    const source = request();
    const answer = b.open(source);

    source.input.command = 'changed';
    const preview = b.pending()[0]!;

    (preview.input as { command: string }).command = 'also changed';
    expect(b.pending()[0]?.input).toEqual({ command: 'pwd' });
    expect(b.resolve('request-a', 'generation-a', 'always' as 'allow')).toBe(false);
    b.close();
    expect(await answer).toBe('local');
  });
});
