import { DesktopErrorCode } from '../error-codes.js';
import {
  DesktopBridgeChannel,
  DesktopBridgeGlobal,
  desktopBridgeAcknowledgeSchema,
  desktopBridgeEventSchema,
  desktopBridgeLeaseSchema,
  desktopBridgeRequestSchema,
  desktopBridgeResultSchema,
  type DesktopBridge,
  profileAuthUrlSchema,
} from '@protocol';
import type { DesktopContextBridgePort, DesktopIpcRendererPort } from './types/bridge.js';
import type { DesktopDocumentPort } from './types/bridge.js';
import { DesktopPrivateIpcChannel } from '../shared/private-ipc.js';

export function createDesktopPreloadBridge(ipcRenderer: DesktopIpcRendererPort): DesktopBridge {
  return {
    open: async () => desktopBridgeLeaseSchema.parse(await ipcRenderer.invoke(DesktopBridgeChannel.Open)),
    request: async (request) => {
      const safeRequest = desktopBridgeRequestSchema.parse(request);

      const result = desktopBridgeResultSchema.parse(
        await ipcRenderer.invoke(DesktopBridgeChannel.Request, safeRequest),
      );

      if (
        result.requestId !== safeRequest.requestId ||
        result.leaseId !== safeRequest.leaseId ||
        result.epoch !== safeRequest.epoch
      ) {
        throw new Error(DesktopErrorCode.STALE_DESKTOP_RESULT);
      }

      return result;
    },
    subscribe: (listener) => {
      const receive = (_event: unknown, raw: unknown) => {
        const parsed = desktopBridgeEventSchema.safeParse(raw);

        if (!parsed.success) {
          return;
        }

        try {
          listener(parsed.data);
        } finally {
          const acknowledgement = desktopBridgeAcknowledgeSchema.parse({
            leaseId: parsed.data.leaseId,
            epoch: parsed.data.epoch,
            sequence: parsed.data.sequence,
          });

          void ipcRenderer.invoke(DesktopBridgeChannel.Acknowledge, acknowledgement).catch(() => {});
        }
      };

      ipcRenderer.on(DesktopBridgeChannel.Event, receive);

      return () => ipcRenderer.off(DesktopBridgeChannel.Event, receive);
    },
    close: async (leaseId, epoch) => {
      const lease = desktopBridgeLeaseSchema.parse({ leaseId, epoch });

      await ipcRenderer.invoke(DesktopBridgeChannel.Close, lease);
    },
  };
}

export function exposeDesktopPreloadBridge(
  contextBridge: DesktopContextBridgePort,
  ipcRenderer: DesktopIpcRendererPort,
  documentPort: DesktopDocumentPort,
): void {
  contextBridge.exposeInMainWorld(DesktopBridgeGlobal.Name, createDesktopPreloadBridge(ipcRenderer));

  documentPort.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest('a');
      const authUrl = anchor?.getAttribute('href');

      if (
        !anchor ||
        anchor.target.toLowerCase() !== '_blank' ||
        !authUrl ||
        !profileAuthUrlSchema.safeParse(authUrl).success
      ) {
        return;
      }

      event.preventDefault();

      try {
        void ipcRenderer.invoke(DesktopPrivateIpcChannel.ProfileAuth, authUrl).catch(() => {});
      } catch {
        // The private auth capability is best effort and exposes no renderer error details.
      }
    },
    true,
  );
}
