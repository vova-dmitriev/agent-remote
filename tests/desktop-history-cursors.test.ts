import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DeviceStatus,
  ErrorCode,
  FrameType,
  HistoryCursorPrefix,
  HistoryDirection,
  LocalOperation,
  type EventEnvelope,
  type HistoryMessage,
  type HistoryRead,
  type LocalAction,
  type ServerFrame,
} from '@protocol';
import { TranscriptPages } from '../apps/daemon/src/code/transcript/transcript-pages.js';
import { localHistory } from '../apps/daemon/src/local/controller/history.js';
import type { LocalControllerOptions } from '../apps/daemon/src/local/controller/types.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { DesktopHistory } from '../apps/mini-app/src/app/api/desktop/history.js';
import type { DesktopBridgeConnection } from '../apps/mini-app/src/app/api/desktop/desktop-connection.js';
import { sessionSnapshot } from './e2e/support/session-fixtures.js';

type HistoryAction = Extract<LocalAction, { operation: typeof LocalOperation.History }>;
type Page = { before: string | null; after: string | null };

const sessionId = 'terminal-session';

function snapshot(generation: string): ServerFrame {
  const base = sessionSnapshot('device');

  return {
    type: FrameType.Snapshot,
    deviceId: 'device',
    snapshot: {
      ...base,
      deviceStatus: DeviceStatus.Online,
      sessions: base.sessions.map((session) =>
        session.id === sessionId ? { ...session, generation } : session,
      ),
    },
    connectors: [],
  };
}

/** Mimics the daemon's native transcript cursor rule: Before/After accept only a cursor it returned. */
function harness(pages: Page[]) {
  const issued = new Set<string>();
  const requests: HistoryAction[] = [];

  const connection = {
    request: async (action: HistoryAction) => {
      requests.push(action);

      const anchor = action.anchor?.startsWith(HistoryCursorPrefix.Source)
        ? action.anchor.slice(HistoryCursorPrefix.Source.length)
        : action.anchor;

      if (action.direction !== HistoryDirection.Latest && (!anchor || !issued.has(anchor))) {
        throw new Error(ErrorCode.INVALID_CURSOR);
      }

      const page = pages.shift() ?? { before: null, after: null };

      for (const cursor of [page.before, page.after]) {
        if (cursor) {
          issued.add(cursor);
        }
      }

      issued.add('message-offset');

      return { events: [], ...page };
    },
  } as unknown as DesktopBridgeConnection;

  const history = new DesktopHistory(connection, { onConnection: () => {}, onFrame: () => {} });

  history.observe(snapshot('generation-one'));

  return { history, requests };
}

describe('desktop history cursors', () => {
  it('pages before with the cursor each response returned', async () => {
    const { history, requests } = harness([
      { before: 'before-1', after: null },
      { before: 'before-2', after: 'unused-after' },
      { before: null, after: 'unused-after' },
    ]);

    await history.load(sessionId);
    await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toEqual([]);
    expect(requests.at(-1)?.anchor).toBe('before-1');
    await history.page(sessionId, HistoryDirection.Before);
    expect(requests.at(-1)?.anchor).toBe('before-2');
    await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toBeNull();
    await expect(history.page(sessionId, HistoryDirection.After)).resolves.toBeNull();
    expect(requests).toHaveLength(3);
  });

  it('pages after with the cursor each response returned', async () => {
    const { history, requests } = harness([
      { before: null, after: 'after-1' },
      { before: 'unused-before', after: 'after-2' },
    ]);

    await history.load(sessionId);
    await history.page(sessionId, HistoryDirection.After);
    expect(requests.at(-1)?.anchor).toBe('after-1');
    await history.page(sessionId, HistoryDirection.After);
    expect(requests.at(-1)?.anchor).toBe('after-2');
    await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toBeNull();
  });

  it('sends no request when the edge in that direction is exhausted', async () => {
    const { history, requests } = harness([{ before: null, after: null }]);

    await history.load(sessionId);
    await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toBeNull();
    await expect(history.page(sessionId, HistoryDirection.After)).resolves.toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('translates a loaded message position into a source cursor like the web transport', async () => {
    const { history, requests } = harness([{ before: 'before-1', after: null }]);

    await history.load(sessionId);
    await history.page(sessionId, HistoryDirection.Before, HistoryCursorPrefix.Position + 'message-offset');
    expect(requests.at(-1)?.anchor).toBe(HistoryCursorPrefix.Source + 'message-offset');
  });

  it('drops cursors from a previous generation', async () => {
    const { history, requests } = harness([{ before: 'before-1', after: null }]);

    await history.load(sessionId);
    history.observe(snapshot('generation-two'));
    await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toBeNull();
    expect(requests).toHaveLength(1);
  });
});

describe('desktop history against the daemon native transcript pages', () => {
  it('scrolls to the top and back without INVALID_CURSOR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-history-'));
    const store = new LocalStore(':memory:', 'device');

    try {
      const path = join(root, 'source.jsonl');

      const row = (i: number) =>
        JSON.stringify({
          type: 'assistant',
          sessionId: 'source',
          uuid: 'm' + i,
          timestamp: new Date(i + 1).toISOString(),
          message: { content: 'Synthetic ' + i },
        }) + '\n';

      await writeFile(path, Array.from({ length: 250 }, (_, i) => row(i)).join(''));

      const pages = new TranscriptPages({
        path,
        allowedRoot: root,
        sessionId: 'source',
        transform: async (m) => m,
      });

      const options = { deviceId: 'device', store, history: (request: HistoryRead) => pages.page(request) };

      const connection = {
        request: (action: HistoryAction) =>
          localHistory(options as unknown as LocalControllerOptions, action),
      } as unknown as DesktopBridgeConnection;

      const history = new DesktopHistory(connection, { onConnection: () => {}, onFrame: () => {} });

      const ids = (events: EventEnvelope[] | null) =>
        (events ?? []).map((event) => (event.payload as HistoryMessage).id);

      history.observe(snapshot('generation-one'));
      const latest = await history.load(sessionId);

      expect(ids(latest).at(-1)).toBe('m249');
      const older = await history.page(sessionId, HistoryDirection.Before);

      expect(ids(older).at(-1)).toBe('m149');
      const oldest = await history.page(sessionId, HistoryDirection.Before);

      expect(ids(oldest)[0]).toBe('m0');
      await expect(history.page(sessionId, HistoryDirection.Before)).resolves.toBeNull();
      const edge = (oldest?.[0]?.payload as HistoryMessage).historyCursor;

      expect(ids(await history.page(sessionId, HistoryDirection.Before, edge))).toEqual([]);
      const lastLoaded = (latest?.at(-1)?.payload as HistoryMessage).historyCursor;

      expect(ids(await history.page(sessionId, HistoryDirection.After, lastLoaded))).toEqual(['m249']);
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
