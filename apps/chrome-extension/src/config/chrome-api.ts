import type { ExtensionApiValue } from './values.js';

interface ChromeEvent<T> {
  addListener(listener: T): void;
  removeListener(listener: T): void;
}

interface ChromeSender {
  id?: string;
  url?: string;
  origin?: string;
  frameId?: number;
  documentLifecycle?: string;
}

export interface ChromePort {
  readonly name: string;
  readonly sender?: ChromeSender;
  onMessage: ChromeEvent<(message: unknown, port: ChromePort) => void>;
  onDisconnect: ChromeEvent<(port: ChromePort) => void>;
  postMessage(message: unknown): void;
  disconnect(): void;
}

export interface ChromeApi {
  runtime: {
    id: string;
    lastError?: { message?: string };
    getURL(path: string): string;
    connect(options: { name: string }): ChromePort;
    connectNative(name: string): ChromePort;
    onConnect: ChromeEvent<(port: ChromePort) => void>;
    onInstalled: ChromeEvent<() => void>;
  };
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      setAccessLevel(options: { accessLevel: typeof ExtensionApiValue.TrustedContexts }): Promise<void>;
    };
  };
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  tabs: { create(options: { url: string }): Promise<unknown> };
}

export const chromeApi = () => (globalThis as unknown as { chrome: ChromeApi }).chrome;
