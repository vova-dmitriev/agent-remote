import { expect, it } from 'vitest';
import { attachViewer } from '../../../apps/chrome-extension/src/background/broker.js';
import type { ChromeApi, ChromePort } from '../../../apps/chrome-extension/src/config/chrome-api.js';

function port(sender?: ChromePort['sender']) {
  const listeners = new Set<(message: unknown, port: ChromePort) => void>();
  const disconnections = new Set<(port: ChromePort) => void>();
  const posted: unknown[] = [];
  let disconnected = false;

  const value: ChromePort = {
    name: 'agent-remote-viewer',
    ...(sender ? { sender } : {}),
    onMessage: {
      addListener: (fn) => {
        listeners.add(fn);
      },
      removeListener: (fn) => {
        listeners.delete(fn);
      },
    },
    onDisconnect: {
      addListener: (fn) => {
        disconnections.add(fn);
      },
      removeListener: (fn) => {
        disconnections.delete(fn);
      },
    },
    postMessage: (message) => {
      posted.push(message);
    },
    disconnect: () => {
      disconnected = true;
    },
  };

  return {
    value,
    posted,
    disconnected: () => disconnected,
    message: (message: unknown) => {
      for (const fn of listeners) {
        fn(message, value);
      }
    },
    close: () => {
      for (const fn of disconnections) {
        fn(value);
      }
    },
  };
}

function fixture(sender: ChromePort['sender']) {
  const viewer = port(sender);
  const native = port();
  let nativeConnections = 0;

  const api = {
    runtime: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      getURL: (path: string) => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path,
      connectNative: () => {
        nativeConnections++;

        return native.value;
      },
    },
  } as unknown as ChromeApi;

  return { viewer, native, api, count: () => nativeConnections };
}

it.each([
  { id: 'other', url: 'https://example.com/' },
  { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://example.com/' },
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extension.html',
    frameId: 1,
  },
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/other.html',
  },
])('rejects an unauthorized sender before opening a native port: %j', (sender) => {
  const f = fixture(sender);

  attachViewer(f.viewer.value, f.api);
  expect(f.count()).toBe(0);
  expect(f.viewer.disconnected()).toBe(true);
});

it('closes malformed viewer traffic without forwarding it as a privileged request', () => {
  const f = fixture({
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extension.html',
    frameId: 0,
  });

  attachViewer(f.viewer.value, f.api);
  f.viewer.message({ operation: 'shell', command: 'do something' });
  expect(f.native.posted).toEqual([]);
  expect(f.viewer.disconnected()).toBe(true);
});
