import {
  DesktopBridgeChannel,
  DesktopBridgeError,
  DesktopBridgeKind,
  DesktopBridgeVersion,
  ErrorCode,
  LOCAL_LIMITS,
  desktopBridgeAcknowledgeSchema,
  desktopBridgeLeaseSchema,
  desktopBridgeRequestSchema,
  desktopBridgeResultSchema,
  profileAuthUrlSchema,
  type DesktopBridgeResult,
} from '../../../../packages/protocol/src/index.js';
import { shell } from 'electron';
import {
  DesktopPrivateIpcChannel,
  type DesktopPrivateIpcChannel as DesktopPrivateIpcChannelType,
} from '../shared/private-ipc.js';
import type { DesktopCompanionConnector } from './companion-port.js';
import type {
  DesktopInvokeEvent,
  DesktopInvokeHandler,
  DesktopIpcController,
  DesktopIpcPort,
  DesktopWindowPort,
} from './ipc.types.js';
import { isTrustedDesktopUrl } from './config/links.js';
import { DesktopEventDelivery, sameDesktopLease } from './event-delivery.js';

export type {
  DesktopInvokeEvent,
  DesktopInvokeHandler,
  DesktopIpcController,
  DesktopIpcPort,
  DesktopWebContentsPort,
  DesktopWindowPort,
} from './ipc.types.js';

export function installDesktopIpc(
  ipcMain: DesktopIpcPort,
  currentWindow: () => DesktopWindowPort | null,
  connector: DesktopCompanionConnector,
  openExternal: (url: string) => Promise<void> = shell.openExternal,
): DesktopIpcController {
  let epoch = 0;
  let disposed = false;
  const delivery = new DesktopEventDelivery(currentWindow, connector);

  const trusted = (event: DesktopInvokeEvent) => {
    const window = currentWindow();

    return Boolean(
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame !== null &&
      event.senderFrame.parent === null &&
      event.senderFrame === window.webContents.mainFrame &&
      isTrustedDesktopUrl(event.senderFrame.url),
    );
  };

  const revoke = () => delivery.revoke();

  const handle = (
    channel: DesktopBridgeChannel | DesktopPrivateIpcChannelType,
    callback: DesktopInvokeHandler,
  ) => {
    ipcMain.handle(channel, async (event, payload) => {
      if (disposed || !trusted(event)) {
        throw new Error(DesktopBridgeError.Unavailable);
      }

      return callback(event, payload);
    });
  };

  handle(DesktopBridgeChannel.Open, () => {
    return delivery.open(++epoch);
  });

  handle(DesktopPrivateIpcChannel.ProfileAuth, async (_event, payload) => {
    const authUrl = profileAuthUrlSchema.safeParse(payload);

    if (!authUrl.success) {
      throw new Error(DesktopBridgeError.Unavailable);
    }

    try {
      await openExternal(new URL(authUrl.data).href);
    } catch {
      throw new Error(DesktopBridgeError.Unavailable);
    }
  });

  handle(DesktopBridgeChannel.Request, async (_event, payload) => {
    const request = desktopBridgeRequestSchema.parse(payload);

    const active = delivery.lease;

    if (!active || !sameDesktopLease(active.lease, request)) {
      throw new Error(DesktopBridgeError.Unavailable);
    }

    if (Buffer.byteLength(JSON.stringify(request)) > LOCAL_LIMITS.frameBytes) {
      throw new Error(ErrorCode.INVALID_REQUEST);
    }

    if (active.pendingRequests >= LOCAL_LIMITS.maxPendingRequests) {
      throw new Error(ErrorCode.REQUEST_FAILED);
    }

    const current = active;
    const aborter = new AbortController();

    current.pendingRequests += 1;
    current.aborters.add(aborter);

    let result: DesktopBridgeResult;

    try {
      const data = await connector.request(request.action, aborter.signal);

      if (delivery.lease !== current || aborter.signal.aborted) {
        throw new Error(DesktopBridgeError.Unavailable);
      }

      const serialized = JSON.stringify(data);

      if (serialized === undefined || Buffer.byteLength(serialized) > LOCAL_LIMITS.frameBytes) {
        throw new Error(ErrorCode.INVALID_REQUEST);
      }

      result = {
        kind: DesktopBridgeKind.Result,
        version: DesktopBridgeVersion.V1,
        requestId: request.requestId,
        leaseId: request.leaseId,
        epoch: request.epoch,
        ok: true,
        data,
      };
    } catch (error) {
      if (delivery.lease !== current) {
        throw new Error(DesktopBridgeError.Unavailable);
      }

      const code = safeErrorCode(error);

      result = {
        kind: DesktopBridgeKind.Result,
        version: DesktopBridgeVersion.V1,
        requestId: request.requestId,
        leaseId: request.leaseId,
        epoch: request.epoch,
        ok: false,
        code,
      };
    } finally {
      current.pendingRequests -= 1;
      current.aborters.delete(aborter);
    }

    return desktopBridgeResultSchema.parse(result);
  });

  handle(DesktopBridgeChannel.Acknowledge, (_event, payload) => {
    const acknowledgement = desktopBridgeAcknowledgeSchema.parse(payload);

    delivery.acknowledge(acknowledgement);
  });

  handle(DesktopBridgeChannel.Close, (_event, payload) => {
    const lease = desktopBridgeLeaseSchema.parse(payload);

    if (delivery.lease && sameDesktopLease(delivery.lease.lease, lease)) {
      revoke();
    }
  });

  return {
    revoke,
    dispose: () => {
      disposed = true;
      revoke();
      Object.values(DesktopBridgeChannel).forEach((channel) => ipcMain.removeHandler(channel));
      ipcMain.removeHandler(DesktopPrivateIpcChannel.ProfileAuth);
    },
  };
}

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';

  return Object.values(ErrorCode).includes(value as (typeof ErrorCode)[keyof typeof ErrorCode])
    ? value
    : ErrorCode.REQUEST_FAILED;
}
