import { DesktopBridgeChannel, type DesktopBridgeEvent } from '@protocol';
import type { DesktopPrivateIpcChannel as DesktopPrivateIpcChannelType } from '../../shared/private-ipc.js';

export interface DesktopWebContentsPort {
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
  send(channel: typeof DesktopBridgeChannel.Event, event: DesktopBridgeEvent): void;
}

export interface DesktopWindowPort {
  readonly webContents: DesktopWebContentsPort;
  isDestroyed(): boolean;
}

export interface DesktopInvokeEvent {
  readonly sender: DesktopWebContentsPort;
  readonly senderFrame: { readonly url: string; readonly parent: unknown | null } | null;
}

export type DesktopInvokeHandler = (
  event: DesktopInvokeEvent,
  payload?: unknown,
) => unknown | Promise<unknown>;

export interface DesktopIpcPort {
  handle(channel: DesktopBridgeChannel | DesktopPrivateIpcChannelType, handler: DesktopInvokeHandler): void;
  removeHandler(channel: DesktopBridgeChannel | DesktopPrivateIpcChannelType): void;
}

export interface DesktopIpcController {
  dispose(): void;
  revoke(): void;
}
