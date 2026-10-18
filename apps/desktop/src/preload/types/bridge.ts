import type { DesktopBridge, DesktopBridgeChannel } from '../../../../../packages/protocol/src/index.js';
import type { DesktopPrivateIpcChannel } from '../../shared/private-ipc.js';

export type DesktopPreloadBridge = DesktopBridge;

export interface DesktopIpcRendererPort {
  invoke(channel: DesktopBridgeChannel | DesktopPrivateIpcChannel, payload?: unknown): Promise<unknown>;
  on(channel: DesktopBridgeChannel, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: DesktopBridgeChannel, listener: (event: unknown, payload: unknown) => void): void;
}

export interface DesktopContextBridgePort {
  exposeInMainWorld(name: string, api: DesktopPreloadBridge): void;
}

export interface DesktopDocumentPort {
  addEventListener(type: 'click', listener: (event: MouseEvent) => void, useCapture: true): void;
}

declare global {
  interface Window {
    desktopBridge?: DesktopPreloadBridge;
  }
}
