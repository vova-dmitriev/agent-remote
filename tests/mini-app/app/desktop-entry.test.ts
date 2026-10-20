import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopBridgeError, HostKind } from '@protocol';
import { createDesktopHost } from '@/app/host/desktop-host.js';

describe('desktop shared UI entry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores Telegram initData and reports a missing privileged bridge explicitly', () => {
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'synthetic' } } });
    const host = createDesktopHost();

    expect(host.kind).toBe(HostKind.Desktop);

    expect(() => host.createClient({ onConnection: () => {}, onFrame: () => {} })).toThrow(
      DesktopBridgeError.Unavailable,
    );
  });
});
