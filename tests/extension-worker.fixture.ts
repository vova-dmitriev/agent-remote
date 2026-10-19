import { vi } from 'vitest';
import type { ChromeApi, ChromePort } from '../apps/chrome-extension/src/config/chrome-api.js';
import { FragmentReader, fragmentValue } from '@transport/native/fragments.js';

export function workerPort(trusted = true) {
  const messages = new Set<(value: unknown, port: ChromePort) => void>();
  const disconnects = new Set<(port: ChromePort) => void>();
  const posted: unknown[] = [];
  let disconnected = false;

  const port: ChromePort = {
    name: 'agent-remote-viewer',
    sender: {
      id: trusted ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'attacker',
      url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extension.html',
      frameId: 0,
    },
    onMessage: {
      addListener: (listener) => messages.add(listener),
      removeListener: (listener) => messages.delete(listener),
    },
    onDisconnect: {
      addListener: (listener) => disconnects.add(listener),
      removeListener: (listener) => disconnects.delete(listener),
    },
    postMessage: (value) => {
      posted.push(value);
    },
    disconnect: () => {
      disconnected = true;
    },
  };

  return {
    port,
    posted,
    disconnected: () => disconnected,
    message: (value: unknown) => {
      for (const listener of messages) {
        listener(value, port);
      }
    },
    native: (value: unknown) => {
      for (const piece of fragmentValue(value, crypto.randomUUID())) {
        for (const listener of messages) {
          listener(piece, port);
        }
      }
    },
    close: () => {
      for (const listener of disconnects) {
        listener(port);
      }
    },
  };
}

export function workerFixture(stored: Record<string, unknown> = {}) {
  const native: ReturnType<typeof workerPort>[] = [];

  const api = {
    runtime: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      getURL: (path: string) => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path,
      connectNative: () => {
        const next = workerPort();

        native.push(next);

        return next.port;
      },
    },
    storage: {
      local: {
        get: vi.fn(async () => structuredClone(stored)),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, items);
        },
        setAccessLevel: async () => {},
      },
    },
  } as unknown as ChromeApi;

  return { api, native, stored };
}

export function nativeValue(port: ReturnType<typeof workerPort>) {
  const reader = new FragmentReader();
  let value: unknown;

  for (const piece of port.posted) {
    const decoded = reader.accept(piece);

    if (decoded !== undefined) {
      value = decoded;
    }
  }

  return value as Record<string, unknown>;
}
