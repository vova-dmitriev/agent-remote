import type { Page } from '@playwright/test';
import { DesktopBridgeKind, DesktopBridgeVersion, FrameType, LocalOperation, ErrorCode, type AppSnapshot } from '@protocol';

interface FakeBridgeOptions {
  deviceId: string;
  snapshot: AppSnapshot;
  values: {
    event: string;
    result: string;
    version: number;
    snapshot: string;
    operations: Record<'devices' | 'select' | 'history' | 'preferences' | 'reading' | 'draft' | 'queue', string>;
    unavailable: string;
  };
}

/** Installs a synthetic `window.desktopBridge` so the desktop host runs in a plain browser page. */
export async function installDesktopBridge(page: Page, deviceId: string, snapshot: AppSnapshot) {
  const options: FakeBridgeOptions = {
    deviceId,
    snapshot,
    values: {
      event: DesktopBridgeKind.Event,
      result: DesktopBridgeKind.Result,
      version: DesktopBridgeVersion.V1,
      snapshot: FrameType.Snapshot,
      operations: {
        devices: LocalOperation.Devices,
        select: LocalOperation.Select,
        history: LocalOperation.History,
        preferences: LocalOperation.PreferencesGet,
        reading: LocalOperation.ReadingGet,
        draft: LocalOperation.DraftGet,
        queue: LocalOperation.QueueGet,
      },
      unavailable: ErrorCode.CAPABILITY_UNAVAILABLE,
    },
  };

  await page.addInitScript(({ deviceId, snapshot, values }: FakeBridgeOptions) => {
    const leaseId = crypto.randomUUID();
    const epoch = 1;
    const listeners = new Set<(event: unknown) => void>();
    const { operations } = values;

    const data: Record<string, unknown> = {
      [operations.devices]: [{ id: deviceId, last_seen_at: new Date().toISOString() }],
      [operations.select]: null,
      [operations.history]: { events: [], before: null, after: null },
      [operations.preferences]: { language: null, theme: null },
      [operations.reading]: { revision: 0, position: null },
      [operations.draft]: { revision: 0, text: '', attachments: [] },
      [operations.queue]: { revision: 0, intents: [] },
    };

    Object.defineProperty(window, 'desktopBridge', {
      value: {
        open: async () => {
          setTimeout(() => {
            const frame = { type: values.snapshot, deviceId, snapshot, connectors: [] };

            for (const listener of listeners) listener({ kind: values.event, version: values.version, leaseId, epoch, sequence: 1, frame });
          }, 0);

          return { leaseId, epoch };
        },
        request: async (request: { requestId: string; action: { operation: string } }) => {
          const base = { kind: values.result, version: values.version, requestId: request.requestId, leaseId, epoch };
          const operation = request.action.operation;

          return operation in data ? { ...base, ok: true, data: data[operation] } : { ...base, ok: false, code: values.unavailable };
        },
        subscribe: (listener: (event: unknown) => void) => {
          listeners.add(listener);

          return () => listeners.delete(listener);
        },
        close: async () => {},
      },
    });
  }, options);
}
