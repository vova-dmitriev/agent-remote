import type { LocalAction, ServerFrame } from '@protocol';

/** Main-process-only adapter; the connector never crosses the renderer bridge. */
export interface DesktopCompanionConnector {
  request(action: LocalAction, signal?: AbortSignal): Promise<unknown>;
  subscribe(listener: (frame: ServerFrame) => void): () => void;
  close(): Promise<void>;
}

export interface DesktopCompanionOptions {
  verifiedResourceRoot: string;
  privateUserDataRoot: string;
  platform: NodeJS.Platform;
  architecture: string;
  appVersion: string;
  confirmLocalAccess(): Promise<boolean>;
}

export type DesktopCompanionFactory = (
  options: DesktopCompanionOptions,
) => Promise<DesktopCompanionConnector>;
