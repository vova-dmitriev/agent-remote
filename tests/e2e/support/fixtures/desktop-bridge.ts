import type { Page } from '@playwright/test';
import { DesktopBridgeKind, DesktopBridgeVersion, FrameType, LocalOperation, ErrorCode, type AppSnapshot } from '@protocol';

interface FakeBridgeOptions {
  deviceId: string;
  snapshot: AppSnapshot;
  /** History events per subagent id, answered for history requests that name that agent. */
  agents: Record<string, unknown[]>;
  /** History events answered for the parent session's history requests. */
  history: unknown[];
  values: {
    event: string;
    result: string;
    version: number;
    snapshot: string;
    operations: Record<'devices' | 'select' | 'history' | 'preferences' | 'reading' | 'draft' | 'queue' | 'pin' | 'file' | 'analytics' | 'rules', string>;
    unavailable: string;
  };
}

/** Subagent ids of the history requests the fake bridge received, in order. */
export const subagentReads = (page: Page) =>
  page.evaluate(() => (window as unknown as { subagentReads?: string[] }).subagentReads ?? []);

/** Installs a synthetic `window.desktopBridge` so the desktop host runs in a plain browser page. */
export async function installDesktopBridge(
  page: Page,
  deviceId: string,
  snapshot: AppSnapshot,
  agents: Record<string, unknown[]> = {},
  history: unknown[] = [],
) {
  const options: FakeBridgeOptions = {
    deviceId,
    snapshot,
    agents,
    history,
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
        pin: LocalOperation.Pin,
        file: LocalOperation.File,
        analytics: LocalOperation.Analytics,
        rules: LocalOperation.Rules,
      },
      unavailable: ErrorCode.CAPABILITY_UNAVAILABLE,
    },
  };

  await page.addInitScript(({ deviceId, snapshot, agents, history, values }: FakeBridgeOptions) => {
    const leaseId = crypto.randomUUID();
    const epoch = 1;
    const listeners = new Set<(event: unknown) => void>();
    let sequence = 0;

    const publish = () => {
      const frame = { type: values.snapshot, deviceId, snapshot, connectors: [] };

      sequence += 1;
      for (const listener of listeners) listener({ kind: values.event, version: values.version, leaseId, epoch, sequence, frame });
    };

    const { operations } = values;

    const data: Record<string, unknown> = {
      [operations.devices]: [{ id: deviceId, last_seen_at: new Date().toISOString() }],
      [operations.select]: null,
      [operations.history]: { events: history, before: null, after: null },
      [operations.preferences]: { language: null, theme: null },
      [operations.reading]: { revision: 0, position: null },
      [operations.draft]: { revision: 0, text: '', attachments: [] },
      [operations.queue]: { revision: 0, intents: [] },
    };

    Object.defineProperty(window, 'desktopBridge', {
      value: {
        open: async () => {
          setTimeout(publish, 0);

          return { leaseId, epoch };
        },
        request: async (request: {
          requestId: string;
          action: { operation: string; agentId?: string; sessionId?: string; pinned?: boolean; path?: string; period?: string; request?: unknown };
        }) => {
          const base = { kind: values.result, version: values.version, requestId: request.requestId, leaseId, epoch };
          const { operation, agentId } = request.action;

          // Like the companion: the pin is applied to the snapshot, which is published again. `pinRefused` simulates
          // a device that cannot take it.
          // A changed file as the companion reads it from the Mac: synthetic Markdown.
          if (operation === operations.file) {
            return { ...base, ok: true, data: { path: request.action.path, content: '# Synthetic notes\n\n**Formatted** body.', truncated: false } };
          }

          // Rules as the companion keeps them; a test sets `rulesReply` and reads `rulesRequests`.
          if (operation === operations.rules) {
            const rules = window as unknown as { rulesReply?: unknown; rulesRequests?: unknown[] };

            rules.rulesRequests = [...(rules.rulesRequests ?? []), request.action.request];

            return rules.rulesReply ? { ...base, ok: true, data: rules.rulesReply } : { ...base, ok: false, code: values.unavailable };
          }

          // Usage as the companion counts it; a test sets `usageReport` before the app asks.
          if (operation === operations.analytics) {
            const usage = window as unknown as { usageReport?: unknown; usageReads?: string[] };
            const report = usage.usageReport;

            usage.usageReads = [...(usage.usageReads ?? []), request.action.period ?? ''];

            return report ? { ...base, ok: true, data: report } : { ...base, ok: false, code: values.unavailable };
          }

          if (operation === operations.pin) {
            if ((window as unknown as { pinRefused?: boolean }).pinRefused) return { ...base, ok: false, code: values.unavailable };

            snapshot = {
              ...snapshot,
              sessions: snapshot.sessions.map((session) => {
                if (session.id !== request.action.sessionId) return session;

                const rest = Object.fromEntries(Object.entries(session).filter(([key]) => key !== 'pinned'));

                return (request.action.pinned ? { ...rest, pinned: true } : rest) as typeof session;
              }),
            };

            setTimeout(publish, 0);

            return { ...base, ok: true, data: null };
          }

          if (operation === operations.history && agentId !== undefined) {
            // Recorded so tests can count subagent reads that reached the bridge.
            (window as unknown as { subagentReads?: string[] }).subagentReads = [
              ...((window as unknown as { subagentReads?: string[] }).subagentReads ?? []),
              agentId,
            ];

            return { ...base, ok: true, data: { events: agents[agentId] ?? [], before: null, after: null } };
          }

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
