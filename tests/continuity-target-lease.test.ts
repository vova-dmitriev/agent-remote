import { expect, it, vi } from 'vitest';
import { ContinuityCompatibilityReason, ErrorCode } from '../packages/protocol/src/index.js';
import { AppTransport } from '../apps/mini-app/src/shared/api/transport.js';

it('invalidates a retained continuation handle when the selected target changes during its request', async () => {
  const client = new AppTransport('synthetic', { onConnection: () => {}, onFrame: () => {} });
  const source = { deviceId: 'device', sessionId: 'session', generation: 'generation' };
  let complete!: (value: unknown) => void;

  const response = new Promise<unknown>((resolve) => {
    complete = resolve;
  });

  vi.spyOn(client, 'request').mockImplementation(() => response as Promise<never>);
  client.selectTarget(source.deviceId, source.sessionId);
  const handle = client.continuity(source.deviceId);
  const pending = handle.inspect(source);
  const assertion = expect(pending).rejects.toThrow(ErrorCode.STALE_EPOCH);

  client.selectTarget(source.deviceId, 'another-session');

  complete({
    source: {
      sessionId: source.sessionId,
      generation: source.generation,
      supported: false,
      reason: ContinuityCompatibilityReason.UnknownProfile,
    },
    conversation: null,
    sourceExecution: null,
    pendingHandoff: null,
  });

  try {
    await assertion;
    await expect(handle.inspect(source)).rejects.toThrow(ErrorCode.STALE_EPOCH);
  } finally {
    client.close();
    vi.restoreAllMocks();
  }
});
