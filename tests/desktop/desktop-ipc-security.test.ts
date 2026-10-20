import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DesktopBridgeChannel,
  DesktopBridgeKind,
  DesktopBridgeVersion,
  LOCAL_LIMITS,
  LocalOperation,
  desktopBridgeRequestSchema,
  type ServerFrame,
} from '@protocol';
import { resolveDesktopAsset } from '../../apps/desktop/src/main/protocol/asset-path.js';
import { DESKTOP_ASSET_URL } from '../../apps/desktop/src/main/config/links.js';
import { DesktopPrivateIpcChannel } from '../../apps/desktop/src/shared/private-ipc.js';
import { createDesktopIpcFixture as createFixture } from '../helpers/desktop-ipc-fixture.js';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

describe('desktop main IPC boundary', () => {
  it('opens only a validated auth URL from the exact live main frame', async () => {
    const fixture = createFixture();
    const openProfileAuth = fixture.handlers.get(DesktopPrivateIpcChannel.ProfileAuth)!;
    const authUrl = 'https://auth.openai.com/authorize?state=synthetic';

    await openProfileAuth(fixture.event(), authUrl);
    expect(fixture.openExternal).toHaveBeenCalledWith(authUrl);

    await openProfileAuth(
      fixture.event({ mainFrameUrl: `${DESKTOP_ASSET_URL}#/sessions/synthetic-session` }),
      authUrl,
    );

    expect(fixture.openExternal).toHaveBeenCalledTimes(2);

    // Events are built at call time: the live main frame is one shared object whose URL each event sets.
    for (const [event, url] of [
      [() => fixture.event({ url: `${DESKTOP_ASSET_URL}?query=1` }), authUrl],
      [() => fixture.event({ mainFrameUrl: `${DESKTOP_ASSET_URL}?query=1#/` }), authUrl],
      [() => fixture.event({ mainFrameUrl: `${DESKTOP_ASSET_URL}/..#/` }), authUrl],
      [() => fixture.event({ mainFrameUrl: 'agent-remote://user@bundle/desktop.html#/' }), authUrl],
      [() => fixture.event({ sender: {} as never }), authUrl],
      [() => fixture.event({ frameParent: {} }), authUrl],
      [() => fixture.event({ differentFrame: true }), authUrl],
      [() => fixture.event({ missingFrame: true }), authUrl],
      [() => fixture.event(), 'https://auth.openai.com.attacker.test/'],
      [() => fixture.event(), 'file:///etc/passwd'],
    ] as const) {
      await expect(openProfileAuth(event(), url)).rejects.toThrow();
    }

    fixture.destroyWindow();
    await expect(openProfileAuth(fixture.event(), authUrl)).rejects.toThrow();
    expect(fixture.openExternal).toHaveBeenCalledTimes(2);
  });

  it('serves only fixed assets under the trusted root and rejects traversal or symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-assets-'));
    const asset = join(root, 'assets');
    const outside = join(root, 'private.txt');

    await mkdir(asset);
    await writeFile(join(asset, 'bundle.js'), 'synthetic');
    await writeFile(outside, 'private');
    await symlink(outside, join(asset, 'linked.txt'));

    try {
      expect(await resolveDesktopAsset(root, 'agent-remote://bundle/assets/bundle.js')).toBe(
        await realpath(join(asset, 'bundle.js')),
      );

      for (const url of [
        'agent-remote://bundle/%2e%2e/private.txt',
        'agent-remote://bundle/assets%2f..%2fprivate.txt',
        'https://example.invalid/assets/bundle.js',
        'agent-remote://bundle/assets/linked.txt',
        'agent-remote://bundle/assets/bundle.js?raw=1',
      ]) {
        expect(await resolveDesktopAsset(root, url)).toBeNull();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects foreign senders and non-exact trusted asset URLs', async () => {
    const fixture = createFixture();
    const invoke = fixture.handlers.get(DesktopBridgeChannel.Open)!;

    await expect(invoke(fixture.event({ sender: {} as never }))).rejects.toThrow();

    await expect(invoke(fixture.event({ url: `${DESKTOP_ASSET_URL}?next=/` }))).rejects.toThrow();

    await expect(invoke(fixture.event({ url: 'agent-remote://evil/desktop.html' }))).rejects.toThrow();
    expect(fixture.connector.subscribe).not.toHaveBeenCalled();
  });

  it('rejects stale leases and actions outside the shared local schema', async () => {
    const fixture = createFixture();
    const lease = await fixture.handlers.get(DesktopBridgeChannel.Open)!(fixture.event());

    const request = desktopBridgeRequestSchema.parse({
      kind: DesktopBridgeKind.Request,
      version: DesktopBridgeVersion.V1,
      requestId: crypto.randomUUID(),
      leaseId: crypto.randomUUID(),
      epoch: 1,
      action: { operation: LocalOperation.Devices },
    });

    await expect(
      fixture.handlers.get(DesktopBridgeChannel.Request)!(fixture.event(), request),
    ).rejects.toThrow();

    await expect(
      fixture.handlers.get(DesktopBridgeChannel.Request)!(fixture.event(), {
        ...request,
        leaseId: (lease as { leaseId: string }).leaseId,
        action: { operation: 'execute_shell', command: 'open' },
      }),
    ).rejects.toThrow();

    expect(fixture.connector.request).not.toHaveBeenCalled();
  });

  it('orders events behind matching acknowledgements and unsubscribes on close', async () => {
    const fixture = createFixture();

    const lease = (await fixture.handlers.get(DesktopBridgeChannel.Open)!(fixture.event())) as {
      leaseId: string;
      epoch: number;
    };

    const emit = fixture.emitFrame!;
    const deliver = fixture.window.webContents.send as ReturnType<typeof vi.fn>;
    const frame: ServerFrame = { type: 'error', code: 'SYNTHETIC' } as ServerFrame;

    emit(frame);
    emit(frame);
    expect(deliver).toHaveBeenCalledTimes(1);

    const first = deliver.mock.calls[0]![1] as { sequence: number };
    const ack = fixture.handlers.get(DesktopBridgeChannel.Acknowledge)!;

    await expect(
      ack(fixture.event(), { leaseId: lease.leaseId, epoch: lease.epoch, sequence: first.sequence + 1 }),
    ).rejects.toThrow();

    await ack(fixture.event(), { leaseId: lease.leaseId, epoch: lease.epoch, sequence: first.sequence });
    expect(deliver).toHaveBeenCalledTimes(2);

    await fixture.handlers.get(DesktopBridgeChannel.Close)!(fixture.event(), lease);
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    emit(frame);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('revokes a lease when an unacknowledged event queue exceeds shared bounds', async () => {
    const fixture = createFixture();

    const lease = (await fixture.handlers.get(DesktopBridgeChannel.Open)!(fixture.event())) as {
      leaseId: string;
      epoch: number;
    };

    const frame = { type: 'error', code: 'SYNTHETIC' } as ServerFrame;

    for (let index = 0; index <= LOCAL_LIMITS.maxPendingRequests + 1; index += 1) {
      fixture.emitFrame!(frame);
    }

    expect(fixture.unsubscribe).toHaveBeenCalledOnce();

    await expect(
      fixture.handlers.get(DesktopBridgeChannel.Acknowledge)!(fixture.event(), {
        leaseId: lease.leaseId,
        epoch: lease.epoch,
        sequence: 1,
      }),
    ).rejects.toThrow();
  });
});
