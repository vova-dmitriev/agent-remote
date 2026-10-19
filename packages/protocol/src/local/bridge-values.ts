export const DesktopBridgeKind = {
  Request: 'request',
  Event: 'event',
  Result: 'result',
} as const;

export type DesktopBridgeKind = (typeof DesktopBridgeKind)[keyof typeof DesktopBridgeKind];

export const DesktopBridgeVersion = { V1: LOCAL_LIMITS.protocolVersion } as const;
export type DesktopBridgeVersion = (typeof DesktopBridgeVersion)[keyof typeof DesktopBridgeVersion];

export const DesktopBridgeChannel = {
  Open: 'desktop:open',
  Request: 'desktop:request',
  Event: 'desktop:event',
  Acknowledge: 'desktop:acknowledge',
  Close: 'desktop:close',
} as const;

export type DesktopBridgeChannel = (typeof DesktopBridgeChannel)[keyof typeof DesktopBridgeChannel];

export const DesktopBridgeGlobal = { Name: 'desktopBridge' } as const;

export const DesktopBridgeError = { Unavailable: 'DESKTOP_BRIDGE_UNAVAILABLE' } as const;
export type DesktopBridgeError = (typeof DesktopBridgeError)[keyof typeof DesktopBridgeError];

import { LOCAL_LIMITS } from './local-limits.js';
