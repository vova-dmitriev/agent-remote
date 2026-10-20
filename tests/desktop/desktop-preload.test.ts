import { describe, expect, it, vi } from 'vitest';
import { DesktopBridgeChannel, DesktopBridgeKind, DesktopBridgeVersion } from '@protocol';
import { createDesktopPreloadBridge } from '../../apps/desktop/src/preload/bridge.js';
import type { DesktopIpcRendererPort } from '../../apps/desktop/src/preload/types/bridge.js';
import type { DesktopPrivateIpcChannel } from '../../apps/desktop/src/shared/private-ipc.js';

describe('desktop preload capability', () => {
  it('exposes only the fixed bridge and acknowledges parsed ordered events', async () => {
    const listeners = new Map<
      DesktopBridgeChannel | DesktopPrivateIpcChannel,
      (event: unknown, payload: unknown) => void
    >();

    const invoke = vi.fn(async (channel: DesktopBridgeChannel | DesktopPrivateIpcChannel) => {
      if (channel === DesktopBridgeChannel.Open) {
        return { leaseId: crypto.randomUUID(), epoch: 1 };
      }

      return undefined;
    });

    const ipc: DesktopIpcRendererPort = {
      invoke,
      on: (channel, listener) => listeners.set(channel, listener),
      off: (channel, listener) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel);
        }
      },
    };

    const bridge = createDesktopPreloadBridge(ipc);
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const leaseId = crypto.randomUUID();

    listeners.get(DesktopBridgeChannel.Event)?.(null, {
      kind: DesktopBridgeKind.Event,
      version: DesktopBridgeVersion.V1,
      leaseId,
      epoch: 2,
      sequence: 1,
      frame: { type: 'error', code: 'SYNTHETIC' },
    });

    expect(listener).toHaveBeenCalledOnce();

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(DesktopBridgeChannel.Acknowledge, {
        leaseId,
        epoch: 2,
        sequence: 1,
      }),
    );

    unsubscribe();
    expect(listeners.has(DesktopBridgeChannel.Event)).toBe(false);
    expect(Object.keys(bridge).sort()).toEqual(['close', 'open', 'request', 'subscribe']);
  });
});
