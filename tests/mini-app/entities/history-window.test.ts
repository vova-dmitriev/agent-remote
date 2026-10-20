import { describe, expect, it } from 'vitest';
import {
  DeviceStatus,
  FrameType,
  HistoryCursorPrefix,
  HistoryDirection,
  HistoryQueryKey,
  type EventEnvelope,
  type ServerFrame,
} from '@protocol';
import { HistoryStream } from '@/entities/session/api/history.js';
import { HistoryWindow } from '@/entities/session/api/history-window.js';
import { SubagentHistory } from '@/entities/session/api/subagent-history.js';
import { HistoryPageSkip } from '@/shared/api/types.js';
import { sessionSnapshot } from '../../e2e/support/fixtures/session-fixtures.js';

const AGENT = 'a0000000000000001';
const event = { eventId: 'e1', payload: {} } as EventEnvelope;

function loadedWindow() {
  const window = new HistoryWindow();

  window.observe({
    before: HistoryCursorPrefix.Source + 'older',
    after: HistoryCursorPrefix.Source + 'newer',
  });

  return window;
}

describe('web history window', () => {
  it('maps a loaded message position to a source cursor and strips the cache prefix', async () => {
    const window = loadedWindow();
    const queries: string[] = [];

    const record = async (query: string) => {
      queries.push(query);

      return [event];
    };

    await window.page(HistoryDirection.Before, record, () => true, HistoryCursorPrefix.Position + '12');
    await window.page(HistoryDirection.After, record, () => true, HistoryCursorPrefix.Cache + 'relay-cursor');
    await window.page(HistoryDirection.Before, record, () => true, 'unprefixed');

    expect(queries).toEqual([
      '?before=' + encodeURIComponent(HistoryCursorPrefix.Source + '12'),
      '?after=relay-cursor',
      '?before=' + encodeURIComponent(HistoryCursorPrefix.Source + 'older'),
    ]);
  });

  it('keeps an older page in flight from blocking a newer one, and the other way round', async () => {
    const window = loadedWindow();
    let release!: () => void;

    const held = new Promise<EventEnvelope[]>((resolve) => {
      release = () => resolve([event]);
    });

    const before = window.page(
      HistoryDirection.Before,
      () => held,
      () => true,
    );

    expect(
      await window.page(
        HistoryDirection.Before,
        async () => [event],
        () => true,
      ),
    ).toBe(HistoryPageSkip.Busy);

    expect(
      await window.page(
        HistoryDirection.After,
        async () => [event],
        () => true,
      ),
    ).toEqual([event]);

    release();
    expect(await before).toEqual([event]);
  });
});

describe('web subagent history', () => {
  function snapshot(generation: string): Extract<ServerFrame, { type: typeof FrameType.Snapshot }> {
    const base = sessionSnapshot('device');
    const session = { ...base.sessions[0]!, generation };

    return {
      type: FrameType.Snapshot,
      deviceId: 'device',
      snapshot: { ...base, sessions: [session], deviceStatus: DeviceStatus.Online },
      connectors: [],
    };
  }

  it('starts a new subagent window when the session generation changes', async () => {
    const paths: string[] = [];
    const stream = new HistoryStream();

    const history = new SubagentHistory(async (path, observe) => {
      paths.push(path);
      observe(new Response(null, { headers: { 'x-next-cursor': HistoryCursorPrefix.Source + 'older' } }));

      return [event];
    }, stream);

    const first = snapshot('generation-1');
    const sessionId = first.snapshot.sessions[0]!.id;

    stream.changed(first);
    await history.page(sessionId, AGENT, HistoryDirection.Latest, () => true);
    expect(await history.page(sessionId, AGENT, HistoryDirection.Before, () => true)).toEqual([event]);

    // A restarted session's subagent has not loaded yet: the old generation's cursors prove nothing.
    stream.changed(snapshot('generation-2'));

    expect(await history.page(sessionId, AGENT, HistoryDirection.Before, () => true)).toBe(
      HistoryPageSkip.Stale,
    );

    expect(paths).toEqual([
      '/sessions/' + sessionId + '/events?' + HistoryQueryKey.AgentId + '=' + AGENT,
      '/sessions/' +
        sessionId +
        '/events?before=' +
        encodeURIComponent(HistoryCursorPrefix.Source + 'older') +
        '&' +
        HistoryQueryKey.AgentId +
        '=' +
        AGENT,
    ]);
  });
});
