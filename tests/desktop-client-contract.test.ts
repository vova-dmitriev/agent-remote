import { describe, expect, it, vi } from 'vitest';
import {
  DesktopBridgeKind,
  AttachmentKind,
  ErrorCode,
  LOCAL_LIMITS,
  type DesktopBridgeEvent,
  type DesktopBridgeRequest,
  type DesktopBridgeResult,
  DesktopBridgeVersion,
  FrameType,
  LocalOperation,
  ProfileRequestKind,
  AgentProvider,
  desktopBridgeEventSchema,
  desktopBridgeLeaseSchema,
  desktopBridgeRequestSchema,
} from '../packages/protocol/src/index.js';
import { DesktopBridgeConnection } from '../apps/mini-app/src/shared/api/desktop/desktop-connection.js';
import { DesktopApplicationClient } from '../apps/mini-app/src/shared/api/desktop/application-client.js';
import { DesktopMedia } from '../apps/mini-app/src/shared/api/desktop/media.js';

describe('desktop bridge contract', () => {
  it('keeps native grant secrets and principals out of the renderer lease', () => {
    const parsed = desktopBridgeLeaseSchema.safeParse({
      leaseId: '00000000-0000-4000-8000-000000000002',
      epoch: 1,
      handle: 'synthetic-secret',
      ownerId: 'synthetic-owner',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects actions outside the shared local protocol', () => {
    const parsed = desktopBridgeRequestSchema.safeParse({
      kind: DesktopBridgeKind.Request,
      version: DesktopBridgeVersion.V1,
      requestId: '00000000-0000-4000-8000-000000000001',
      leaseId: '00000000-0000-4000-8000-000000000002',
      epoch: 1,
      action: { operation: 'arbitrary_ipc', channel: 'shell' },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects media chunks larger than the local protocol limit', () => {
    const parsed = desktopBridgeRequestSchema.safeParse({
      kind: DesktopBridgeKind.Request,
      version: DesktopBridgeVersion.V1,
      requestId: '00000000-0000-4000-8000-000000000003',
      leaseId: '00000000-0000-4000-8000-000000000002',
      epoch: 1,
      action: {
        operation: LocalOperation.MediaChunk,
        transferId: 'transfer-1',
        offset: 0,
        data: 'A'.repeat(350_000),
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects oversized encoding and invalid base64 padding before media decoding', async () => {
    const originalAtob = globalThis.atob;
    const atob = vi.fn(originalAtob.bind(globalThis));

    vi.stubGlobal('atob', atob);

    try {
      const invalidChunks = ['A'.repeat(Math.ceil(LOCAL_LIMITS.chunkBytes / 3) * 4 + 4), 'A==='];

      for (const data of invalidChunks) {
        const connection = {
          request: vi.fn(async (action: { operation: string }) => {
            if (action.operation === LocalOperation.MediaRead) {
              return {
                transferId: 'transfer-1',
                descriptor: {
                  id: 'attachment-1',
                  name: 'file.txt',
                  mimeType: 'text/plain',
                  byteLength: 1,
                  sha256: '0'.repeat(64),
                  kind: AttachmentKind.File,
                },
              };
            }

            return { data, done: false };
          }),
        };

        const media = new DesktopMedia(connection as never);

        await expect(
          media.download('session-1', 'attachment-1', new AbortController().signal),
        ).rejects.toThrow();
      }

      expect(atob).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects profile replies from an earlier A to B to A target selection', async () => {
    let finish!: (response: unknown) => void;

    const delayed = new Promise<unknown>((resolve) => {
      finish = resolve;
    });

    const connection = {
      request: vi.fn((action: { operation: string }) =>
        action.operation === LocalOperation.Profiles ? delayed : Promise.resolve(null),
      ),
      close: vi.fn(),
    };

    const client = new DesktopApplicationClient(connection as never, {
      onConnection: () => {},
      onFrame: () => {},
    });

    client.selectTarget('device-a', null);
    const profiles = client.profiles!('device-a');
    const pending = profiles.request({ kind: ProfileRequestKind.List });

    client.selectTarget('device-b', null);
    client.selectTarget('device-a', null);

    finish({
      kind: ProfileRequestKind.List,
      data: {
        available: true,
        observedAt: 1,
        profiles: [],
        operations: [],
        defaults: { [AgentProvider.Claude]: null, [AgentProvider.Codex]: null },
      },
    });

    await expect(pending).rejects.toThrow(ErrorCode.STALE_EPOCH);
    client.close();
  });

  it('does not submit a media chunk when abort arrives during file reading', async () => {
    let finishRead!: (buffer: ArrayBuffer) => void;

    const fileRead = new Promise<ArrayBuffer>((resolve) => {
      finishRead = resolve;
    });

    const file = new File(['synthetic'], 'synthetic.txt', { type: 'text/plain' });
    const slice = vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => fileRead } as Blob);

    const request = vi.fn(async (action: { operation: string }) =>
      action.operation === LocalOperation.MediaBegin ? { transferId: 'transfer-1' } : null,
    );

    const media = new DesktopMedia({ request } as never);
    const controller = new AbortController();
    const upload = media.upload('session-1', 'generation-1', file, 'upload-1', controller.signal, () => {});

    await vi.waitFor(() => expect(slice).toHaveBeenCalledOnce());
    controller.abort();
    finishRead(new TextEncoder().encode('synthetic').buffer);

    await expect(upload).rejects.toThrow(ErrorCode.ATTACHMENT_CANCELLED);
    expect(request.mock.calls.some(([action]) => action.operation === LocalOperation.MediaChunk)).toBe(false);
  });

  it('drops events from old leases and removes its subscription when closed', async () => {
    const first = createLease('00000000-0000-4000-8000-000000000002', 1);
    const second = createLease('00000000-0000-4000-8000-000000000003', 2);
    let active = first;
    const listeners = new Set<(event: DesktopBridgeEvent) => void>();

    const connection = new DesktopBridgeConnection({
      open: async () => ({ leaseId: active.leaseId, epoch: active.epoch }),
      request: async () => ({
        kind: DesktopBridgeKind.Result,
        version: DesktopBridgeVersion.V1,
        requestId: '00000000-0000-4000-8000-000000000004',
        leaseId: active.leaseId,
        epoch: active.epoch,
        ok: true,
        data: null,
      }),
      subscribe: (listener) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
          first.unsubscribe();
        };
      },
      close: async (leaseId) => {
        if (leaseId === second.leaseId) {
          second.close();
        }
      },
    });

    const listener = vi.fn();

    await connection.start();
    const unsubscribe = connection.subscribe(listener);

    listeners.forEach((callback) => callback(frame(first.leaseId, 1)));
    expect(listener).toHaveBeenCalledTimes(1);

    active = second;
    await connection.reconnect();
    listeners.forEach((callback) => callback(frame(first.leaseId, 1)));
    listeners.forEach((callback) => callback(frame(second.leaseId, 2)));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await connection.close();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a delayed response after reconnect changes the lease epoch', async () => {
    const first = createLease('00000000-0000-4000-8000-000000000002', 1);
    const second = createLease('00000000-0000-4000-8000-000000000003', 2);
    let active = first;
    let request: DesktopBridgeRequest | undefined;
    let finish!: (result: DesktopBridgeResult) => void;

    const delayed = new Promise<DesktopBridgeResult>((resolve) => {
      finish = resolve;
    });

    const connection = new DesktopBridgeConnection({
      open: async () => ({ leaseId: active.leaseId, epoch: active.epoch }),
      request: async (input) => {
        request = input;

        return delayed;
      },
      subscribe: () => () => {},
      close: async () => {},
    });

    await connection.start();
    const pending = connection.request({ operation: LocalOperation.Devices });

    active = second;
    await connection.reconnect();

    finish({
      kind: DesktopBridgeKind.Result,
      version: DesktopBridgeVersion.V1,
      requestId: request!.requestId,
      leaseId: first.leaseId,
      epoch: first.epoch,
      ok: true,
      data: [],
    });

    await expect(pending).rejects.toThrow('STALE_SESSION');
    await connection.close();
  });
});

function createLease(leaseId: string, epoch: number) {
  let eventListener: ((event: unknown) => void) | undefined;

  const lease = {
    leaseId,
    epoch,
    request: vi.fn(async () => undefined),
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      eventListener = listener;

      return () => {
        lease.unsubscribe();
        eventListener = undefined;
      };
    }),
    unsubscribe: vi.fn(),
    close: vi.fn(),
    emit: (event: unknown) => eventListener?.(event),
  };

  return lease;
}

function frame(leaseId: string, epoch: number) {
  return desktopBridgeEventSchema.parse({
    kind: DesktopBridgeKind.Event,
    version: DesktopBridgeVersion.V1,
    leaseId,
    epoch,
    sequence: 1,
    frame: { type: FrameType.Error, code: 'SYNTHETIC' },
  });
}
