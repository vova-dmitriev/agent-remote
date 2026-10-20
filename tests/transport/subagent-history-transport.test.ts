import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  ActivityKind,
  DeviceStatus,
  ErrorCode,
  FrameType,
  HistoryDirection,
  HistoryCursorPrefix,
  HistoryQueryKey,
  LocalOperation,
  historyReadSchema,
  historySchema,
  localActionSchema,
  sessionSchema,
  subagentSchema,
  SubagentStatus,
  ToolActivityPhase,
  type HistoryRead,
  type LocalAction,
  type ServerFrame,
} from '@protocol';
import { databaseFixture } from '../helpers/relay/database.js';
import { SourceHistory } from '@server/history/source.js';
import { HistoryRepository } from '@server/history/repository.js';
import type { Principal } from '@server/auth/security.js';
import { localHistory } from '@daemon/local/controller/history.js';
import type { LocalControllerOptions } from '@daemon/local/controller/types.js';
import { LocalStore } from '@daemon/monitor/store.js';
import { DesktopHistory } from '@/app/api/desktop/history.js';
import type { DesktopBridgeConnection } from '@/app/api/desktop/desktop-connection.js';
import { HistoryWindow } from '@/entities/session/api/history-window.js';
import { sessionSnapshot } from '../e2e/support/fixtures/session-fixtures.js';
import { attachmentRelayFixture } from '../helpers/relay/attachment-relay.js';

type HistoryAction = Extract<LocalAction, { operation: typeof LocalOperation.History }>;

const AGENT = 'a0000000000000001';

describe('subagent wire tolerance', () => {
  it('strips unknown subagent fields and reads an unknown status as unknown', () => {
    const parsed = subagentSchema.parse({
      id: AGENT,
      name: 'reviewer',
      type: 'reviewer',
      description: 'Synthetic review',
      transcriptAvailable: true,
      status: 'future_status',
      updatedAt: 1,
      futureField: { nested: true },
    });

    expect(parsed).toEqual({
      id: AGENT,
      name: 'reviewer',
      type: 'reviewer',
      description: 'Synthetic review',
      transcriptAvailable: true,
      status: SubagentStatus.Unknown,
      updatedAt: 1,
    });

    // An invalid optional detail is dropped instead of rejecting the snapshot.
    expect(subagentSchema.parse({ id: AGENT, status: 'running', updatedAt: 1, type: '' })).toEqual({
      id: AGENT,
      status: SubagentStatus.Running,
      updatedAt: 1,
    });

    const session = sessionSnapshot('device').sessions[0]!;

    expect(
      sessionSchema.safeParse({
        ...session,
        subagents: [{ id: AGENT, status: 'running', updatedAt: 1, futureField: 1 }],
      }).success,
    ).toBe(true);
  });

  it('tolerates an unknown tool kind on a history item and keeps plain items unchanged', () => {
    const plain = { id: 'm', role: 'assistant', text: 'Synthetic', occurredAt: 1 };

    expect(historySchema.parse(plain)).toEqual(plain);

    expect(
      historySchema.parse({
        ...plain,
        tool: { id: 'toolu_1', phase: ToolActivityPhase.Started, kind: 'future_kind', extra: 1 },
      }).tool,
    ).toEqual({ id: 'toolu_1', phase: ToolActivityPhase.Started, kind: ActivityKind.Tool });
  });

  it('strips unknown history and capability keys and reads an unknown tool phase as completed', () => {
    const plain = { id: 'm', role: 'assistant', text: 'Synthetic', occurredAt: 1 };

    expect(historySchema.parse({ ...plain, futureField: { nested: true } })).toEqual(plain);

    expect(historySchema.parse({ ...plain, tool: { id: 'toolu_1', phase: 'future_phase' } }).tool).toEqual({
      id: 'toolu_1',
      phase: ToolActivityPhase.Completed,
    });

    // A phase is required: only an unknown value is tolerated, never a missing one.
    expect(historySchema.safeParse({ ...plain, tool: { id: 'toolu_1' } }).success).toBe(false);
    expect(historySchema.safeParse({ ...plain, tool: { id: 'toolu_1', phase: 1 } }).success).toBe(false);

    const session = sessionSnapshot('device').sessions[0]!;

    const parsed = sessionSchema.parse({
      ...session,
      capabilities: { ...session.capabilities, subagentHistory: true, futureCapability: true },
    });

    expect(parsed.capabilities).toEqual({ ...session.capabilities, subagentHistory: true });

    // Known fields keep their validation.
    expect(historySchema.safeParse({ ...plain, role: 'system' }).success).toBe(false);
    expect(historySchema.safeParse({ ...plain, text: 'x'.repeat(65_537) }).success).toBe(false);

    expect(
      sessionSchema.safeParse({ ...session, capabilities: { ...session.capabilities, prompt: 'yes' } })
        .success,
    ).toBe(false);

    expect(
      sessionSchema.safeParse({
        ...session,
        capabilities: {
          ...session.capabilities,
          attachments: { images: 'native', files: 'reference', extra: 1 },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only a single safe path component as a subagent id on both transports', () => {
    const read = {
      type: FrameType.HistoryRead,
      requestId: 'r',
      sessionId: 's',
      generation: 'g',
      direction: HistoryDirection.Latest,
    };

    const local = {
      operation: LocalOperation.History,
      sessionId: 's',
      generation: 'g',
      direction: HistoryDirection.Latest,
    };

    expect(historyReadSchema.safeParse({ ...read, agentId: AGENT }).success).toBe(true);
    expect(localActionSchema.safeParse({ ...local, agentId: AGENT }).success).toBe(true);

    for (const agentId of ['../x', '/etc/passwd', 'a/b', 'a\\b', '.hidden', '', 'a'.repeat(129)]) {
      expect(historyReadSchema.safeParse({ ...read, agentId }).success).toBe(false);
      expect(localActionSchema.safeParse({ ...local, agentId }).success).toBe(false);
    }
  });
});

describe('relay subagent history', () => {
  async function relay(capabilities: Record<string, boolean>, live = true) {
    const fixture = await databaseFixture();

    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','9999',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session',$1)",
      [JSON.stringify({ generation: 'g', capabilities })],
    );

    const connection = {
      socket: {} as WebSocket,
      epoch: 'epoch',
      device: { id: 'device', owner_id: 'owner' },
    };

    const sent: ServerFrame[] = [];
    let dispatch!: () => void;

    const dispatched = new Promise<void>((resolve) => {
      dispatch = resolve;
    });

    const source = new SourceHistory(
      new HistoryRepository(fixture.db),
      new Map(live ? [['device', connection]] : []),
      (_socket, frame) => {
        sent.push(frame);
        dispatch();

        return true;
      },
    );

    return { fixture, source, sent, connection, dispatched };
  }

  it('forwards the subagent id with the same owner, device, session and generation fences', async () => {
    const { fixture, source, sent, connection, dispatched } = await relay({
      historyWindow: true,
      subagentHistory: true,
    });

    try {
      await expect(
        source.page(
          { userId: 'foreign' } as Principal,
          'session',
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          AGENT,
        ),
      ).rejects.toThrow(ErrorCode.NOT_FOUND);

      expect(sent).toHaveLength(0);

      const page = source.page(
        { userId: 'owner' } as Principal,
        'session',
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        AGENT,
      );

      await dispatched;
      const request = sent[0] as HistoryRead;

      expect(request).toMatchObject({
        sessionId: 'session',
        generation: 'g',
        agentId: AGENT,
        direction: 'latest',
      });

      const message = { id: 's-1', role: 'user' as const, text: 'Synthetic subagent task', occurredAt: 1 };

      const item = {
        type: FrameType.HistoryItem,
        requestId: request.requestId,
        sessionId: 'session',
        generation: 'g',
        message,
      };

      // A response from another owner's or device's connection does not reach this page.
      source.accept({ ...connection, device: { id: 'device', owner_id: 'foreign' } }, item);
      source.accept({ ...connection, device: { id: 'other', owner_id: 'owner' } }, item);
      source.accept(connection, item);

      source.accept(connection, {
        type: FrameType.HistoryDone,
        requestId: request.requestId,
        sessionId: 'session',
        generation: 'g',
        before: null,
        after: null,
      });

      expect((await page)?.events.map((event) => event.payload)).toEqual([message]);
      source.close();
    } finally {
      await fixture.close();
    }
  });

  it('refuses invalid ids, legacy cursors, offline devices and daemons without subagent history', async () => {
    const owner = { userId: 'owner' } as Principal;
    const supported = await relay({ historyWindow: true, subagentHistory: true });

    try {
      for (const agentId of ['../x', '/etc/passwd', ['a', 'b']]) {
        await expect(
          supported.source.page(owner, 'session', undefined, undefined, undefined, undefined, false, agentId),
        ).rejects.toThrow(ErrorCode.INVALID_REQUEST);
      }

      await expect(
        supported.source.page(
          owner,
          'session',
          'legacy-cursor',
          undefined,
          undefined,
          undefined,
          false,
          AGENT,
        ),
      ).rejects.toThrow(ErrorCode.INVALID_CURSOR);

      expect(supported.sent).toHaveLength(0);
    } finally {
      await supported.fixture.close();
    }

    const older = await relay({ historyWindow: true });

    try {
      await expect(
        older.source.page(owner, 'session', undefined, undefined, undefined, undefined, false, AGENT),
      ).rejects.toThrow(ErrorCode.TRANSCRIPT_UNAVAILABLE);

      expect(older.sent).toHaveLength(0);
    } finally {
      await older.fixture.close();
    }

    const offline = await relay({ historyWindow: true, subagentHistory: true }, false);

    try {
      await expect(
        offline.source.page(owner, 'session', undefined, undefined, undefined, undefined, false, AGENT),
      ).rejects.toThrow(ErrorCode.SERVICE_UNAVAILABLE);
    } finally {
      await offline.fixture.close();
    }
  });
});

describe('local subagent history', () => {
  it('passes the subagent id to the transcript reader and never falls back to the session cache', async () => {
    const store = new LocalStore(':memory:', 'device');
    const requests: HistoryRead[] = [];

    try {
      const action = {
        operation: LocalOperation.History,
        sessionId: 'session',
        generation: 'g',
        direction: HistoryDirection.Latest,
        agentId: AGENT,
      } as const;

      const reader = {
        deviceId: 'device',
        store,
        history: async (request: HistoryRead) => {
          requests.push(request);

          return { messages: [], before: null, after: null };
        },
      } as unknown as LocalControllerOptions;

      await localHistory(reader, action);
      expect(requests[0]?.agentId).toBe(AGENT);

      const unavailable = {
        deviceId: 'device',
        store,
        history: async () => null,
      } as unknown as LocalControllerOptions;

      await expect(localHistory(unavailable, action)).rejects.toThrow(ErrorCode.TRANSCRIPT_UNAVAILABLE);

      await expect(
        localHistory(reader, {
          ...action,
          direction: HistoryDirection.Before,
          anchor: HistoryCursorPrefix.Cache + 'cursor',
        }),
      ).rejects.toThrow(ErrorCode.INVALID_CURSOR);
    } finally {
      store.close();
    }
  });
});

describe('client subagent history plumbing', () => {
  it('keeps a separate desktop window per subagent and keeps its items out of the parent feed', async () => {
    const requests: HistoryAction[] = [];
    const delivered: string[] = [];

    const connection = {
      request: async (action: HistoryAction) => {
        requests.push(action);

        return { events: [], before: action.agentId ? 'agent-before' : 'parent-before', after: null };
      },
    } as unknown as DesktopBridgeConnection;

    const history = new DesktopHistory(connection, {
      onConnection: () => {},
      onFrame: () => {},
      onHistory: (sessionId) => delivered.push(sessionId),
    });

    const base = sessionSnapshot('device');
    const sessionId = base.sessions[0]!.id;

    history.observe({
      type: FrameType.Snapshot,
      deviceId: 'device',
      snapshot: { ...base, deviceStatus: DeviceStatus.Online },
      connectors: [],
    });

    await history.load(sessionId);
    await history.load(sessionId, AGENT);
    await history.page(sessionId, HistoryDirection.Before, undefined, AGENT);
    await history.page(sessionId, HistoryDirection.Before);

    expect(requests.map(({ agentId, anchor }) => ({ agentId, anchor }))).toEqual([
      { agentId: undefined, anchor: undefined },
      { agentId: AGENT, anchor: undefined },
      { agentId: AGENT, anchor: 'agent-before' },
      { agentId: undefined, anchor: 'parent-before' },
    ]);

    expect(delivered).toEqual([sessionId, sessionId]);
  });

  it('adds the subagent id to web page queries', async () => {
    const window = new HistoryWindow();
    const queries: string[] = [];

    window.observe({ before: 'source:cursor', after: '' });

    await window.page(
      HistoryDirection.Before,
      async (query) => {
        queries.push(query);

        return [];
      },
      () => true,
      undefined,
      AGENT,
    );

    expect(queries).toEqual(['?before=source%3Acursor&agentId=' + AGENT]);
  });
});

describe('relay subagent history route', () => {
  it('never answers a subagent read from cached session events', async () => {
    const f = await attachmentRelayFixture();

    try {
      const device = f.connect('/ws/device', f.deviceToken);

      await device.next('authenticated');
      const headers = { authorization: 'Bearer ' + f.token };
      const url = (query: string) => f.origin + '/sessions/' + f.session.id + '/events?' + query;

      // Supported daemon without a live history window: no fallback to the session cache.
      await f.publish(device, {
        ...f.session,
        capabilities: { ...f.session.capabilities, subagentHistory: true },
      });

      const unwindowed = await fetch(url(HistoryQueryKey.AgentId + '=' + AGENT), { headers });

      expect(unwindowed.status).toBe(404);
      expect(await unwindowed.json()).toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(device.frames.filter((frame) => frame.type === FrameType.HistoryRead)).toHaveLength(0);

      // A window around a message the subagent transcript does not contain: no fallback either.
      await f.publish(device, {
        ...f.session,
        capabilities: { ...f.session.capabilities, historyWindow: true, subagentHistory: true },
      });

      const around = fetch(url('around=missing&' + HistoryQueryKey.AgentId + '=' + AGENT), { headers });
      const request = await device.next(FrameType.HistoryRead);

      expect(request).toMatchObject({
        direction: HistoryDirection.Around,
        agentId: AGENT,
        anchor: 'missing',
      });

      device.send({
        type: FrameType.HistoryDone,
        requestId: request.requestId,
        sessionId: request.sessionId,
        generation: request.generation,
        before: null,
        after: null,
      });

      const response = await around;

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: ErrorCode.NOT_FOUND });

      // Another owner cannot reach the session at all.
      const foreign = await fetch(url(HistoryQueryKey.AgentId + '=' + AGENT), {
        headers: { authorization: 'Bearer ' + f.otherToken },
      });

      expect(foreign.status).toBe(404);
    } finally {
      await f.close();
    }
  });
});
