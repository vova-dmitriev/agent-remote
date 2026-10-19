import { vi } from 'vitest';
import { DesktopBridgeChannel, type LocalAction, type ServerFrame } from '@protocol';
import { installDesktopIpc, type DesktopInvokeEvent } from '../../apps/desktop/src/main/ipc/ipc.js';
import type { DesktopCompanionConnector } from '../../apps/desktop/src/main/companion-port.js';
import { DESKTOP_ASSET_URL } from '../../apps/desktop/src/main/config/links.js';
import type { DesktopPrivateIpcChannel } from '../../apps/desktop/src/shared/private-ipc.js';

export function createDesktopIpcFixture() {
  const handlers = new Map<
    DesktopBridgeChannel | DesktopPrivateIpcChannel,
    (event: DesktopInvokeEvent, payload?: unknown) => unknown
  >();

  let emitFrame: ((frame: ServerFrame) => void) | undefined;
  const unsubscribe = vi.fn(() => {});

  const connector: DesktopCompanionConnector = {
    request: vi.fn(async (_action: LocalAction) => []),
    subscribe: vi.fn((listener) => {
      emitFrame = listener;

      return unsubscribe;
    }),
    close: vi.fn(async () => {}),
  };

  const webContents = { mainFrame: null as unknown, isDestroyed: () => false, send: vi.fn() };
  const mainFrame = { url: DESKTOP_ASSET_URL, parent: null };

  webContents.mainFrame = mainFrame;
  let destroyed = false;
  const window = { webContents, isDestroyed: () => destroyed };
  const openExternal = vi.fn(async (_url: string) => {});

  const ipc = {
    handle: vi.fn(
      (
        channel: DesktopBridgeChannel | DesktopPrivateIpcChannel,
        handler: (event: DesktopInvokeEvent, payload?: unknown) => unknown,
      ) => handlers.set(channel, handler),
    ),
    removeHandler: vi.fn(),
  };

  installDesktopIpc(ipc, () => window, connector, openExternal);

  const event = (
    overrides: {
      sender?: DesktopInvokeEvent['sender'];
      url?: string;
      frameParent?: unknown;
      differentFrame?: boolean;
      missingFrame?: boolean;
    } = {},
  ): DesktopInvokeEvent => {
    let senderFrame: DesktopInvokeEvent['senderFrame'] = mainFrame;

    if (overrides.missingFrame) {
      senderFrame = null;
    } else if (overrides.url || overrides.differentFrame || overrides.frameParent) {
      senderFrame = { url: overrides.url ?? DESKTOP_ASSET_URL, parent: overrides.frameParent ?? null };
    }

    return { sender: overrides.sender ?? webContents, senderFrame };
  };

  return {
    handlers,
    connector,
    emitFrame: (frame: ServerFrame) => emitFrame?.(frame),
    unsubscribe,
    window,
    event,
    openExternal,
    destroyWindow: () => {
      destroyed = true;
    },
  };
}
