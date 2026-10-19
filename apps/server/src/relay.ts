import { ServerErrorCode } from './error-codes.js';
import {
  ConnectorId,
  ErrorCode,
  FrameType,
  canDeliverPrompt,
  DeviceStatus,
  CommandActionType,
  CapabilityKey,
  BindingState,
  IntegrationState,
  TargetKind,
  SessionStatus,
  CommandStatus,
  HandoffPhase,
  appFrameSchema,
  deviceFrameSchema,
  clientCommandSchema,
  eventSchema,
  snapshotSchema,
  validateUserInputAnswers,
  type AppSnapshot,
  type EventEnvelope,
  type ClientCommand,
  type CommandResult,
  type Cursor,
  type ServerFrame,
  type ConnectorDescriptor,
  profileRequestSchema,
  ProfileRequestKind,
} from '@protocol';
import { HealthStatus, HttpMethod } from './domain/http.js';
import { type IncomingMessage } from 'node:http';
import { type Duplex } from 'node:stream';
import { createMessaging } from './infrastructure/messaging.js';
import { SessionLabels } from './sessions/labels.js';
import { PreferenceService } from './preferences/service.js';
import { ReadingPositionService } from './reading-position/service.js';
import { SourceHistory } from './history/source.js';
import { SessionHistory } from './history/service.js';
import { persistEvent, eventNotificationId } from './history/events.js';
import { BoundedSender } from '@transport/bounded-sender.js';
import { ProfileProxy } from './profiles/proxy.js';
import { ServerProfiles } from './profiles/service.js';
import { ProfileMetadataCache } from './profiles/repository.js';
import { DeviceFence } from './devices/fence.js';
import { AttachmentService } from './attachments/service.js';
import { mountAttachmentRoutes } from './attachments/routes.js';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { Database } from './db/database.js';
import { BrowserSessions, readRefreshCookie, refreshCookie } from './auth/browser-sessions.js';
import { AuthService } from './auth/auth-service.js';
import { DeviceService, type DeviceRecord } from './devices/service.js';
import { Fault, Limiter, hash, telegramIdentity, type Principal } from './auth/security.js';
import { claimHandoffCreateCommandId, claimRelayCommandId } from './continuity/command-claims.js';
import { ContinuityService } from './continuity/service.js';
import { ContinuityError } from './continuity/types.js';
import { ContinuityProxy } from './continuity/proxy.js';
import { mountContinuityRoutes } from './continuity/routes.js';

export interface RelayConfig {
  databaseUrl: string;
  redisUrl?: string;
  schema?: string;
  botToken: string;
  botUsername?: string;
  publicOrigin: string;
  inputEnabled?: boolean;
  permissionsEnabled?: boolean;
  staticDirectory?: string;
}
interface DeviceConnection {
  socket: WebSocket;
  epoch: string;
  device: DeviceRecord;
  lastSeen: number;
}
interface AppConnection {
  socket: WebSocket;
  principal: Principal;
  token: string;
  deviceId: string | null;
  sessionId: string | null;
  selected: boolean;
}
const boundedId = z.string().min(1).max(512);
const sha = z.string().regex(/^[a-f0-9]{64}$/);

const bearer = (req: Request) => {
  const value = req.headers.authorization;

  if (!value?.startsWith('Bearer ') || value.length > 520) {
    throw new Fault(ErrorCode.UNAUTHORIZED, 401);
  }

  return value.slice(7);
};

const emptySnapshot = (): AppSnapshot => ({
  sessions: [],
  deviceStatus: DeviceStatus.Offline,
  cursor: { streamId: 'initial', seq: 0 },
  permissions: [],
  terminal: null,
});

const fault = (error: unknown): Fault => {
  if (error instanceof Fault) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new Fault(ErrorCode.INVALID_REQUEST);
  }

  return new Fault(ErrorCode.INTERNAL_ERROR, 503);
};

function commandCapability(action: ClientCommand['action']['type']) {
  switch (action) {
    case CommandActionType.Escape:
      return CapabilityKey.Interrupt;
    case CommandActionType.UserInput:
      return CapabilityKey.UserInput;
    case CommandActionType.CreateSession:
      return CapabilityKey.CreateSession;
    case CommandActionType.RestartSession:
      return CapabilityKey.RestartSession;
    default:
      return action;
  }
}

export async function createRelay(config: RelayConfig) {
  const db = new Database(config.databaseUrl, config.schema);
  let messaging: Awaited<ReturnType<typeof createMessaging>> | undefined;

  try {
    await db.migrate();

    messaging = config.redisUrl
      ? await createMessaging(config.redisUrl, config.databaseUrl + (config.schema ?? 'public'))
      : undefined;
  } catch (error) {
    await db.close();
    throw error;
  }

  const labels = new SessionLabels(db);
  const history = new SessionHistory(db, messaging?.cache);
  const continuity = new ContinuityService(db);

  const auth = new AuthService(db, config.botToken),
    devices = new DeviceService(db),
    limiter = new Limiter();

  class RelayModule {}
  Module({})(RelayModule);
  const app = await NestFactory.create(RelayModule, { logger: false, bodyParser: false });
  const http = app.getHttpAdapter().getInstance() as express.Express;

  http.disable('x-powered-by');

  http.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  const attachments = new AttachmentService(db);
  const fence = new DeviceFence();
  let closing = false;

  const live = new Map<string, DeviceConnection>(),
    clients = new Set<AppConnection>();

  const deviceWss = new WebSocketServer({ noServer: true, maxPayload: 131072, perMessageDeflate: false });
  const appWss = new WebSocketServer({ noServer: true, maxPayload: 131072, perMessageDeflate: false });
  const sender = new BoundedSender();
  const send = (socket: WebSocket, frame: ServerFrame) => sender.send(socket, frame);
  const sourceHistory = new SourceHistory(db, live, send);
  const profileProxy = new ProfileProxy(devices, live, send);
  const continuityProxy = new ContinuityProxy(devices, live, send);
  const profiles = new ServerProfiles(devices, live, profileProxy, new ProfileMetadataCache(db));

  mountAttachmentRoutes(
    http,
    db,
    auth,
    devices,
    attachments,
    Boolean(config.inputEnabled),
    async (context, source) => {
      const page = await sourceHistory.page(
        { userId: context.ownerId },
        context.sessionId,
        undefined,
        source.messageId,
        undefined,
        source.position,
        true,
      );

      if (!page) {
        throw new Fault(ErrorCode.ATTACHMENT_UNAVAILABLE, 503);
      }
    },
  );

  http.use(express.json({ limit: '128kb', strict: true }));

  const fanout = (owner: string, deviceId: string, frame: ServerFrame) => {
    for (const client of clients) {
      if (client.principal.userId === owner && client.deviceId === deviceId) {
        send(client.socket, frame);
      }
    }
  };

  const notify = async (owner: string, key: string, kind: string, sessionId: string | null = null) => {
    const id = hash(owner + ':' + key);

    await db.pool.query(
      'INSERT INTO notification_outbox(id,owner_id,session_id,kind,created_at,next_attempt_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
      [id, owner, sessionId, kind, Date.now()],
    );

    void messaging?.queue.enqueue(id).catch(() => {
      /* PostgreSQL outbox is reconciled by the worker. */
    });
  };

  const offline = async (connection: DeviceConnection) => {
    if (closing) {
      return;
    }

    return fence.run(connection.device.id, async () => {
      if (live.get(connection.device.id) !== connection) {
        return;
      }

      live.delete(connection.device.id);
      profileProxy.disconnect(connection);
      continuityProxy.disconnect(connection);

      fanout(connection.device.owner_id, connection.device.id, {
        type: FrameType.DeviceStatus,
        deviceId: connection.device.id,
        status: DeviceStatus.Offline,
      });

      await notify(connection.device.owner_id, 'offline:' + connection.epoch, DeviceStatus.Offline);
    });
  };

  async function snapshot(p: Principal, deviceId: string) {
    const device = await devices.owned(p, deviceId);
    const data = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();

    data.sessions = await labels.apply(p, deviceId, data.sessions);
    data.deviceStatus = live.has(deviceId) ? DeviceStatus.Online : DeviceStatus.Offline;

    if (data.deviceStatus === DeviceStatus.Offline) {
      data.permissions = [];
      data.userInputs = [];
      data.terminal = null;
    }

    return {
      type: FrameType.Snapshot,
      deviceId,
      snapshot: data,
      connectors: device.connectors as ConnectorDescriptor[],
    };
  }

  async function replay(p: Principal, deviceId: string, cursor: Cursor) {
    await devices.owned(p, deviceId);

    const bounds = await db.pool.query<{ min: string; max: string }>(
      'SELECT min(seq)::text AS min,max(seq)::text AS max FROM events WHERE owner_id=$1 AND device_id=$2 AND stream_id=$3',
      [p.userId, deviceId, cursor.streamId],
    );

    const range = bounds.rows[0];

    if (!range?.min || cursor.seq < Number(range.min) - 1 || cursor.seq > Number(range.max)) {
      return FrameType.ResyncRequired;
    }

    return (
      await db.pool.query<{ data: EventEnvelope }>(
        'SELECT data FROM events WHERE owner_id=$1 AND device_id=$2 AND stream_id=$3 AND seq>$4 ORDER BY seq LIMIT 100',
        [p.userId, deviceId, cursor.streamId, cursor.seq],
      )
    ).rows.map((row) => row.data);
  }

  async function command(p: Principal, input: ClientCommand): Promise<CommandResult> {
    const parsed = clientCommandSchema.parse(input);

    return fence.run(parsed.target.deviceId, () => executeCommand(p, parsed));
  }

  async function dispatchHandoffCreate(p: Principal, operationId: string): Promise<CommandResult> {
    const row = (
      await db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM handoff_operations WHERE owner_id=$1 AND id=$2',
        [p.userId, operationId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    return fence.run(row.device_id, async () => {
      const device = await devices.owned(p, row.device_id);
      const scope = { deviceId: device.id, deviceGeneration: device.generation };
      const operation = await continuity.getHandoff(p, scope, operationId);

      if (operation.phase !== HandoffPhase.CreatingTarget) {
        throw new Fault(ContinuityError.InvalidPhase, 409);
      }

      const conversation = await continuity.getConversation(p, scope, operation.conversationId);

      const source = await continuity.getExecution(
        p,
        scope,
        operation.conversationId,
        operation.sourceExecutionId,
      );

      const snapshot = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();

      const session = snapshot.sessions.find(
        (candidate) =>
          candidate.id === source.nativeSessionId && candidate.generation === operation.sourceGeneration,
      );

      if (
        conversation.activeExecutionId !== operation.sourceExecutionId ||
        conversation.version !== operation.expectedConversationVersion + 1 ||
        source.generation !== operation.sourceGeneration ||
        !session?.cwd
      ) {
        throw new Fault(ErrorCode.STALE_SESSION, 409);
      }

      const input = clientCommandSchema.parse({
        commandId: operation.createCommandId,
        target: session.target,
        sessionId: session.id,
        generation: session.generation,
        action: {
          type: CommandActionType.CreateSession,
          provider: operation.selection.provider,
          cwd: session.cwd,
          execution: {
            selection: operation.selection,
            expectedVersion: operation.expectedProfileVersion,
          },
        },
      });

      return executeCommand(p, input, operation.id);
    });
  }

  async function executeCommand(
    p: Principal,
    input: ClientCommand,
    handoffOperationId?: string,
  ): Promise<CommandResult> {
    const source = clientCommandSchema.parse(input);

    await devices.owned(p, source.target.deviceId);
    const fingerprint = hash(JSON.stringify(source));

    const previous = (
      await db.pool.query<{
        fingerprint: string;
        status: CommandResult['status'];
        code: string | null;
        result_session_id: string | null;
      }>(
        'SELECT fingerprint,status,code,result_session_id FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [p.userId, source.commandId],
      )
    ).rows[0];

    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Fault(ErrorCode.COMMAND_ID_REUSED, 409);
      }

      await db.transaction((tx) =>
        handoffOperationId
          ? claimHandoffCreateCommandId(
              tx,
              p.userId,
              source.target.deviceId,
              source.commandId,
              handoffOperationId,
              fingerprint,
              Date.now(),
            )
          : claimRelayCommandId(
              tx,
              p.userId,
              source.target.deviceId,
              source.commandId,
              fingerprint,
              Date.now(),
            ),
      );

      return {
        commandId: source.commandId,
        status: previous.status,
        ...(previous.code ? { code: previous.code } : {}),
        ...(previous.result_session_id ? { sessionId: previous.result_session_id } : {}),
      };
    }

    limiter.take('command:' + p.userId, 30);
    const connection = live.get(source.target.deviceId);

    if (!connection) {
      throw new Fault(ErrorCode.DEVICE_OFFLINE, 409);
    }

    const device = await devices.owned(p, source.target.deviceId);
    const data = device.snapshot ? snapshotSchema.parse(device.snapshot) : emptySnapshot();
    const session = data.sessions.find((s) => s.id === source.sessionId);

    if (!session || JSON.stringify(session.target) !== JSON.stringify(source.target)) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    if (
      session.generation !== source.generation ||
      (source.action.type !== CommandActionType.RestartSession &&
        (session.binding !== BindingState.Verified || session.integrationState !== IntegrationState.Ready))
    ) {
      throw new Fault(ErrorCode.STALE_SESSION, 409);
    }

    const capability = commandCapability(source.action.type);

    if (
      !session.capabilities[capability] ||
      (source.action.type === CommandActionType.Permission
        ? !config.permissionsEnabled
        : !config.inputEnabled)
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE, 409);
    }

    if (
      source.action.type === CommandActionType.RestartSession &&
      (session.target.kind !== TargetKind.ClaudeCodeCli || session.target.connectorId !== ConnectorId.Native)
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE, 409);
    }

    if (
      source.action.type === CommandActionType.Escape &&
      ![TargetKind.Cmux, TargetKind.ClaudeCodeCli].some(
        (candidateValue) => candidateValue === session.target.kind,
      )
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE, 409);
    }

    if (source.action.type === CommandActionType.CreateSession && source.action.cwd !== session.cwd) {
      throw new Fault(ErrorCode.INVALID_PROJECT, 400);
    }

    if (
      source.action.type === CommandActionType.Prompt &&
      !canDeliverPrompt(session.status, source.action.delivery)
    ) {
      throw new Fault(ErrorCode.SESSION_NOT_IDLE, 409);
    }

    if (source.action.type === CommandActionType.Prompt && source.action.attachments?.length) {
      if (!session.capabilities.attachments) {
        throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE, 409);
      }

      await attachments.validate(
        { ownerId: p.userId, deviceId: device.id, sessionId: session.id },
        source.action.attachments,
      );
    }

    let expiresAt = Date.now() + 15000;

    if (source.action.type === CommandActionType.Permission) {
      const requestId = source.action.requestId;

      const pending = data.permissions.find(
        (r) => r.requestId === requestId && r.sessionId === session.id && r.generation === session.generation,
      );

      if (!pending || pending.expiresAt <= Date.now()) {
        throw new Fault(ErrorCode.PERMISSION_EXPIRED, 409);
      }

      expiresAt = Math.min(expiresAt, pending.expiresAt);
    }

    if (source.action.type === CommandActionType.UserInput) {
      const requestId = source.action.requestId;

      const pending = data.userInputs?.find(
        (request) =>
          request.requestId === requestId &&
          request.sessionId === session.id &&
          request.generation === session.generation,
      );

      if (!pending || pending.expiresAt <= Date.now() || session.status === SessionStatus.Ended) {
        throw new Fault(ErrorCode.USER_INPUT_EXPIRED, 409);
      }

      try {
        validateUserInputAnswers(pending, source.action.answers);
      } catch {
        throw new Fault(ErrorCode.INVALID_USER_INPUT);
      }

      expiresAt = Math.min(expiresAt, pending.expiresAt);
    }

    const inserted = await db.transaction(async (tx) => {
      if (handoffOperationId && source.action.type !== CommandActionType.CreateSession) {
        throw new Fault(ContinuityError.CommandIdReserved, 409);
      }

      const claimed = handoffOperationId
        ? await claimHandoffCreateCommandId(
            tx,
            p.userId,
            source.target.deviceId,
            source.commandId,
            handoffOperationId,
            fingerprint,
            Date.now(),
          )
        : await claimRelayCommandId(
            tx,
            p.userId,
            source.target.deviceId,
            source.commandId,
            fingerprint,
            Date.now(),
          );

      if (!claimed) {
        return { rowCount: 0 };
      }

      const createEvidence =
        source.action.type === CommandActionType.CreateSession && source.action.execution
          ? {
              selection: source.action.execution.selection,
              version: source.action.execution.expectedVersion,
            }
          : null;

      return tx.query(
        'INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at,create_selection,create_expected_profile_version) VALUES($1,$2,$3,$4,$5,$6,$8,$7,$9,$10) ON CONFLICT DO NOTHING RETURNING command_id',
        [
          p.userId,
          source.commandId,
          source.target.deviceId,
          source.sessionId,
          source.action.type,
          fingerprint,
          Date.now(),
          CommandStatus.Accepted,
          createEvidence?.selection ?? null,
          createEvidence?.version ?? null,
        ],
      );
    });

    if (!inserted.rowCount) {
      return executeCommand(p, source);
    }

    if (live.get(source.target.deviceId) !== connection) {
      await db.pool.query('UPDATE command_audit SET status=$3,code=$4 WHERE owner_id=$1 AND command_id=$2', [
        p.userId,
        source.commandId,
        CommandStatus.Rejected,
        ErrorCode.DEVICE_OFFLINE,
      ]);

      return { commandId: source.commandId, status: CommandStatus.Rejected, code: 'DEVICE_OFFLINE' };
    }

    send(connection.socket, { type: FrameType.Command, command: { version: 1, ...source, expiresAt } });

    return { commandId: source.commandId, status: CommandStatus.Accepted };
  }

  const route = (
    method: HttpMethod,
    path: string,
    handler: (req: Request, res: Response) => Promise<unknown>,
  ) =>
    http[method](path, (req, res, next) => {
      Promise.resolve(handler(req, res))
        .then(
          (value) => {
            if (!res.headersSent) {
              res.json(value ?? {});
            }
          },
          (error) => {
            const f = fault(error);

            if (!res.headersSent) {
              res.status(f.status).json({ code: f.code });
            }
          },
        )
        .catch(next);
    });

  const principal = async (req: Request) => auth.authenticate(bearer(req));

  mountContinuityRoutes(
    route,
    principal,
    async (req) => {
      await auth.authenticate(bearer(req));
    },
    devices,
    continuity,
    continuityProxy,
    dispatchHandoffCreate,
  );

  const preferences = new PreferenceService(db, messaging?.cache);

  route(HttpMethod.Get, '/preferences', async (req) => preferences.get(await principal(req)));
  route(HttpMethod.Patch, '/preferences', async (req) => preferences.update(await principal(req), req.body));

  route(HttpMethod.Get, '/health', async () => {
    await db.pool.query('SELECT 1');
    await messaging?.health();

    return { status: HealthStatus.Ok };
  });

  const browserSessions = new BrowserSessions(db);
  const secureCookie = new URL(config.publicOrigin).protocol === 'https:';

  route(HttpMethod.Post, '/auth/telegram', async (req, res) => {
    limiter.take('auth:' + req.ip, 10);
    const body = z.strictObject({ initData: z.string().max(16384) }).parse(req.body);
    const login = await auth.login(body.initData);
    const browser = await browserSessions.create(login.token);

    res.setHeader(
      'Set-Cookie',
      refreshCookie(browser.secret, secureCookie, Math.floor((browser.expiresAt - Date.now()) / 1000)),
    );

    return login;
  });

  route(HttpMethod.Post, '/auth/refresh', async (req) => {
    if (req.headers.origin !== config.publicOrigin) {
      throw new Fault(ErrorCode.ACCESS_DENIED, 403);
    }

    limiter.take('refresh:' + req.ip, 30);
    const body = z.strictObject({ initData: z.string().max(16384).optional() }).parse(req.body ?? {});

    const expected =
      body.initData === undefined
        ? undefined
        : telegramIdentity(body.initData, config.botToken, Date.now(), 30 * 24 * 60 * 60 * 1000);

    return browserSessions.refresh(readRefreshCookie(req.headers.cookie), Date.now(), expected);
  });

  route(HttpMethod.Post, '/auth/logout', async (req, res) => {
    res.setHeader('Set-Cookie', refreshCookie('', secureCookie, 0));
    let revoked: string[];

    try {
      const token = bearer(req);

      await auth.authenticate(token);
      revoked = await auth.logout(token);
    } catch (error) {
      if (
        !(error instanceof Fault) ||
        error.code !== 'UNAUTHORIZED' ||
        req.headers.origin !== config.publicOrigin
      ) {
        throw error;
      }

      revoked = await browserSessions.revoke(readRefreshCookie(req.headers.cookie));
    }

    profileProxy.cancelAuth(revoked);

    for (const client of clients) {
      if (revoked.includes(hash(client.token))) {
        client.socket.close(4001, 'UNAUTHORIZED');
      }
    }

    return {};
  });

  route(HttpMethod.Post, '/device/pair/start', async (req) => {
    limiter.take('pair-start:' + req.ip, 5);
    const body = z.strictObject({ codeHash: sha, proofHash: sha }).parse(req.body);
    const result = await devices.start(body.codeHash, body.proofHash);

    return {
      ...result,
      ...(/^[A-Za-z0-9_]+$/.test(config.botUsername ?? '') ? { botUsername: config.botUsername } : {}),
    };
  });

  route(HttpMethod.Post, '/pair/claim', async (req) => {
    const p = await principal(req);

    limiter.take('pair-ip:' + req.ip, 5);
    limiter.take('pair-owner:' + p.userId, 5);
    const body = z.strictObject({ code: boundedId }).parse(req.body);

    return devices.claim(p, body.code);
  });

  route(HttpMethod.Post, '/device/pair/cancel', async (req) =>
    devices.cancel(z.strictObject({ proof: boundedId }).parse(req.body).proof),
  );

  route(HttpMethod.Post, '/device/pair/status', async (req) =>
    devices.status(z.strictObject({ proof: boundedId }).parse(req.body).proof),
  );

  route(HttpMethod.Post, '/device/pair/confirm', async (req) => {
    const body = z
      .strictObject({ proof: boundedId, claimId: boundedId, approved: z.boolean() })
      .parse(req.body);

    return devices.confirm(body.proof, body.claimId, body.approved);
  });

  route(HttpMethod.Post, '/devices/:deviceId/profiles', async (req, res) => {
    const token = bearer(req);
    const p = await principal(req);
    const deviceId = boundedId.parse(req.params.deviceId);

    limiter.take('profiles:' + p.userId, 120);
    const request = profileRequestSchema.parse(req.body);

    if (
      !config.inputEnabled &&
      request.kind !== ProfileRequestKind.List &&
      request.kind !== ProfileRequestKind.Operation
    ) {
      throw new Fault(ErrorCode.CAPABILITY_UNAVAILABLE, 409);
    }

    const controller = new AbortController();

    const cancel = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };

    res.once('close', cancel);

    try {
      return await profiles.request(
        p,
        deviceId,
        request,
        hash(token),
        async () => {
          await auth.authenticate(token);
        },
        controller.signal,
      );
    } finally {
      res.off('close', cancel);
    }
  });

  route(HttpMethod.Get, '/devices', async (req) => devices.list(await principal(req)));

  route(HttpMethod.Delete, '/devices/:id', async (req) => {
    const p = await principal(req),
      id = String(req.params.id);

    return fence.run(id, async () => {
      await devices.revoke(p, id);
      const connection = live.get(id);

      if (connection) {
        live.delete(id);
        profileProxy.disconnect(connection);
        continuityProxy.disconnect(connection);
        connection.socket.close(4003, 'REVOKED');
      }

      fanout(p.userId, id, { type: FrameType.DeviceStatus, deviceId: id, status: DeviceStatus.Offline });

      return {};
    });
  });

  route(HttpMethod.Get, '/devices/:id/snapshot', async (req) =>
    snapshot(await principal(req), String(req.params.id)),
  );

  route(
    'get',
    '/devices/:id/connectors',
    async (req) => (await devices.owned(await principal(req), String(req.params.id))).connectors,
  );

  route(HttpMethod.Get, '/devices/:id/events', async (req) =>
    replay(await principal(req), String(req.params.id), {
      streamId: boundedId.parse(req.query.streamId),
      seq: z.coerce.number().int().nonnegative().parse(req.query.seq),
    }),
  );

  const readingPositions = new ReadingPositionService(db, messaging?.cache);

  route(HttpMethod.Get, '/sessions/:id/reading-position', async (req) =>
    readingPositions.get(await principal(req), String(req.params.id)),
  );

  route(HttpMethod.Put, '/sessions/:id/reading-position', async (req) =>
    readingPositions.update(await principal(req), String(req.params.id), req.body),
  );

  route(HttpMethod.Get, '/sessions/:id/events', async (req, res) => {
    const p = await principal(req),
      id = String(req.params.id);

    const page =
      (await sourceHistory.page(
        p,
        id,
        req.query.before,
        req.query.around,
        req.query.after,
        req.query.position,
      )) ?? (await history.page(p, id, req.query.before, req.query.around, req.query.after));

    if (page.nextCursor) {
      res.setHeader('X-Next-Cursor', page.nextCursor);
    }

    if (page.afterCursor) {
      res.setHeader('X-After-Cursor', page.afterCursor);
    }

    return page.events;
  });

  route(HttpMethod.Patch, '/sessions/:id', async (req) => {
    const p = await principal(req),
      id = String(req.params.id);

    const row = (
      await db.pool.query<{ device_id: string }>(
        'SELECT device_id FROM sessions WHERE owner_id=$1 AND id=$2',
        [p.userId, id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    return fence.run(row.device_id, async () => {
      const result = await labels.rename(p, id, req.body);

      fanout(p.userId, row.device_id, await snapshot(p, row.device_id));

      return { title: result.title };
    });
  });

  route(HttpMethod.Post, '/commands', async (req) =>
    command(await principal(req), clientCommandSchema.parse(req.body)),
  );

  route(HttpMethod.Get, '/commands/:id', async (req) => {
    const p = await principal(req);

    const row = (
      await db.pool.query(
        'SELECT command_id AS "commandId",status,code,result_session_id AS "sessionId" FROM command_audit WHERE owner_id=$1 AND command_id=$2',
        [p.userId, req.params.id],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND, 404);
    }

    if (row.sessionId === null) {
      delete row.sessionId;
    }

    return row;
  });

  if (config.staticDirectory) {
    http.use(express.static(config.staticDirectory));
  }

  const server = app.getHttpServer();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];

    if (
      (path !== '/ws/app' && path !== '/ws/device') ||
      req.url !== path ||
      (path === '/ws/app' && req.headers.origin !== config.publicOrigin)
    ) {
      socket.destroy();

      return;
    }

    (path === '/ws/app' ? appWss : deviceWss).handleUpgrade(req, socket, head, (ws) =>
      (path === '/ws/app' ? appWss : deviceWss).emit('connection', ws, req),
    );
  });

  appWss.on('connection', (socket, _req) => {
    let client: AppConnection | undefined;
    let chain = Promise.resolve();

    let queued = 0,
      queuedBytes = 0;

    const timeout = setTimeout(() => socket.close(4001, 'AUTH_TIMEOUT'), 5000);

    socket.on('message', (raw) => {
      const bytes = Buffer.byteLength(raw as Buffer);

      if (queued >= 256 || queuedBytes + bytes > 1048576) {
        socket.close(1013, 'QUEUE_FULL');

        return;
      }

      queued++;
      queuedBytes += bytes;

      chain = chain
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN || closing) {
            return;
          }

          const frame = appFrameSchema.parse(JSON.parse(raw.toString()));

          if (!client) {
            if (frame.type !== FrameType.Auth) {
              throw new Fault(ErrorCode.UNAUTHORIZED, 401);
            }

            const p = await auth.authenticate(frame.token);

            if (socket.readyState !== WebSocket.OPEN || closing) {
              return;
            }

            client = {
              socket,
              principal: p,
              token: frame.token,
              deviceId: null,
              sessionId: null,
              selected: false,
            };

            clients.add(client);
            clearTimeout(timeout);
            send(socket, { type: FrameType.Authenticated });

            return;
          }

          await auth.authenticate(client.token);

          if (frame.type === FrameType.Subscribe) {
            await devices.owned(client.principal, frame.deviceId);
            const data = await snapshot(client.principal, frame.deviceId);

            if (frame.sessionId && !data.snapshot.sessions.some((s) => s.id === frame.sessionId)) {
              throw new Fault(ErrorCode.NOT_FOUND, 404);
            }

            client.deviceId = frame.deviceId;
            client.sessionId = frame.sessionId;
            client.selected = true;
            send(socket, data);
            const device = live.get(frame.deviceId);

            if (device) {
              send(device.socket, { type: FrameType.Select, sessionId: frame.sessionId });
            }
          } else if (frame.type === FrameType.Resume) {
            const events = await replay(client.principal, frame.deviceId, frame.cursor);

            if (events === FrameType.ResyncRequired) {
              send(socket, { type: FrameType.ResyncRequired, deviceId: frame.deviceId });
              send(socket, await snapshot(client.principal, frame.deviceId));
            } else {
              for (const event of events) {
                send(socket, { type: FrameType.Event, event });
              }
            }
          } else if (frame.type === FrameType.Command) {
            send(socket, {
              type: FrameType.CommandResult,
              result: await command(client.principal, frame.command),
            });
          } else {
            throw new Fault(ErrorCode.INVALID_FRAME);
          }
        })
        .catch((error) => {
          send(socket, { type: FrameType.Error, code: fault(error).code });

          if (!client) {
            socket.close(4001, 'UNAUTHORIZED');
          }
        })
        .finally(() => {
          queued--;
          queuedBytes -= bytes;
        });
    });

    socket.on('close', () => {
      clearTimeout(timeout);

      if (client) {
        clients.delete(client);
      }
    });

    socket.on('error', () => {});
  });

  deviceWss.on('connection', (socket) => {
    let connection: DeviceConnection | undefined;
    let chain = Promise.resolve();

    let queued = 0,
      queuedBytes = 0;

    const timeout = setTimeout(() => socket.close(4001, 'AUTH_TIMEOUT'), 5000);

    socket.on('message', (raw) => {
      const bytes = Buffer.byteLength(raw as Buffer);

      if (queued >= 256 || queuedBytes + bytes > 1048576) {
        socket.close(1013, 'QUEUE_FULL');

        return;
      }

      queued++;
      queuedBytes += bytes;

      chain = chain
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN || closing) {
            return;
          }

          const frame = deviceFrameSchema.parse(JSON.parse(raw.toString()));

          if (!connection) {
            if (frame.type !== FrameType.Auth) {
              throw new Fault(ErrorCode.UNAUTHORIZED, 401);
            }

            const found = await devices.authenticate(frame.token);

            await fence.run(found.id, async () => {
              const device = await devices.authenticate(frame.token);

              if (socket.readyState !== WebSocket.OPEN || closing) {
                return;
              }

              const previous = live.get(device.id);

              connection = { socket, device, epoch: randomUUID(), lastSeen: Date.now() };
              live.set(device.id, connection);

              if (previous) {
                profileProxy.disconnect(previous);
                continuityProxy.disconnect(previous);
              }

              previous?.socket.close(4002, 'REPLACED');
              clearTimeout(timeout);
              send(socket, { type: FrameType.Authenticated, epoch: connection.epoch });
            });

            return;
          }

          if (frame.type === FrameType.ProfilesResult) {
            await profileProxy.accept(connection, frame);

            return;
          }

          if (frame.type === FrameType.ContinuityResult) {
            await continuityProxy.accept(connection, frame);

            return;
          }

          if (frame.type === FrameType.HistoryItem || frame.type === FrameType.HistoryDone) {
            if (live.get(connection.device.id) !== connection) {
              throw new Fault(ErrorCode.STALE_EPOCH, 409);
            }

            sourceHistory.accept(connection, frame);

            return;
          }

          return fence.run(connection.device.id, async () => {
            if (!connection) {
              return;
            }

            if (live.get(connection.device.id) !== connection) {
              throw new Fault(ErrorCode.STALE_EPOCH, 409);
            }

            const ctx = await devices.owned(
              { userId: connection.device.owner_id, telegramId: '' },
              connection.device.id,
            );

            if (ctx.generation !== connection.device.generation) {
              throw new Fault(ErrorCode.STALE_EPOCH, 409);
            }

            connection.lastSeen = Date.now();

            await db.pool.query('UPDATE devices SET last_seen_at=$1 WHERE owner_id=$2 AND id=$3', [
              connection.lastSeen,
              ctx.owner_id,
              ctx.id,
            ]);

            if (frame.type === FrameType.HandoffSeedIntent) {
              await continuity.admitAuthenticatedSeedIntent(
                { userId: ctx.owner_id, telegramId: '' },
                { deviceId: ctx.id, deviceGeneration: ctx.generation },
                frame,
              );

              if (live.get(connection.device.id) === connection) {
                send(connection.socket, {
                  type: FrameType.HandoffSeedAdmitted,
                  operationId: frame.operationId,
                  seedCommandId: frame.seedCommandId,
                  checkpointId: frame.checkpointId,
                  checkpointDigest: frame.checkpointDigest,
                  targetExecutionId: frame.targetExecutionId,
                  targetGeneration: frame.targetGeneration,
                  selection: frame.selection,
                });
              }

              return;
            }

            if (frame.type === FrameType.HandoffSeedProof) {
              await continuity.recordAuthenticatedSeedProof(
                { userId: ctx.owner_id, telegramId: '' },
                { deviceId: ctx.id, deviceGeneration: ctx.generation },
                frame,
              );

              return;
            } else if (frame.type === FrameType.Heartbeat) {
              return;
            }

            if (frame.type === FrameType.Snapshot) {
              if (frame.snapshot.sessions.some((s) => s.target.deviceId !== ctx.id)) {
                throw new Fault(ErrorCode.INVALID_DEVICE);
              }

              const ids = new Set(frame.snapshot.sessions.map((s) => s.id));

              if (
                ids.size !== frame.snapshot.sessions.length ||
                frame.snapshot.permissions.some(
                  (p) =>
                    !frame.snapshot.sessions.some(
                      (s) => s.id === p.sessionId && s.generation === p.generation,
                    ),
                ) ||
                (frame.snapshot.userInputs &&
                  (new Set(frame.snapshot.userInputs.map((request) => request.requestId)).size !==
                    frame.snapshot.userInputs.length ||
                    frame.snapshot.userInputs.some(
                      (request) =>
                        !frame.snapshot.sessions.some(
                          (session) =>
                            session.id === request.sessionId &&
                            session.generation === request.generation &&
                            session.capabilities.userInput,
                        ),
                    ))) ||
                (frame.snapshot.terminal &&
                  !frame.snapshot.sessions.some(
                    (s) =>
                      s.id === frame.snapshot.terminal!.sessionId &&
                      s.generation === frame.snapshot.terminal!.generation &&
                      s.capabilities.terminalSnapshot,
                  ))
              ) {
                throw new Fault(ServerErrorCode.INVALID_SNAPSHOT);
              }

              frame.snapshot.sessions = await labels.apply(
                { userId: ctx.owner_id, telegramId: '' },
                ctx.id,
                frame.snapshot.sessions,
              );

              frame.snapshot.deviceStatus = DeviceStatus.Online;

              await db.transaction(async (tx) => {
                await tx.query('UPDATE devices SET snapshot=$1,connectors=$2 WHERE owner_id=$3 AND id=$4', [
                  JSON.stringify(frame.snapshot),
                  JSON.stringify(frame.connectors),
                  ctx.owner_id,
                  ctx.id,
                ]);

                await tx.query('DELETE FROM sessions WHERE owner_id=$1 AND device_id=$2', [
                  ctx.owner_id,
                  ctx.id,
                ]);

                for (const session of frame.snapshot.sessions) {
                  await tx.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
                    ctx.owner_id,
                    ctx.id,
                    session.id,
                    JSON.stringify(session),
                  ]);
                }
              });

              fanout(ctx.owner_id, ctx.id, {
                type: FrameType.Snapshot,
                deviceId: ctx.id,
                snapshot: frame.snapshot,
                connectors: frame.connectors,
              });
            } else if (frame.type === FrameType.Event) {
              const event = eventSchema.parse(frame.event);

              if (event.deviceId !== ctx.id) {
                throw new Fault(ErrorCode.INVALID_DEVICE);
              }

              if (
                event.sessionId &&
                !(
                  await db.pool.query(
                    'SELECT id FROM sessions WHERE owner_id=$1 AND device_id=$2 AND id=$3',
                    [ctx.owner_id, ctx.id, event.sessionId],
                  )
                ).rowCount
              ) {
                throw new Fault(ErrorCode.NOT_FOUND, 404);
              }

              if (await persistEvent(db, ctx.owner_id, event)) {
                fanout(ctx.owner_id, ctx.id, { type: FrameType.Event, event });
                const notificationId = eventNotificationId(ctx.owner_id, event);

                if (notificationId) {
                  void messaging?.queue.enqueue(notificationId).catch(() => {});
                }
              }

              send(socket, { type: FrameType.Ack, cursor: { streamId: event.streamId, seq: event.seq } });
            } else if (frame.type === FrameType.CommandResult) {
              if (frame.result.sessionId) {
                const created = await db.pool.query(
                  "SELECT s.id FROM sessions s JOIN command_audit c ON c.owner_id=s.owner_id AND c.device_id=s.device_id WHERE s.owner_id=$1 AND s.device_id=$2 AND s.id=$3 AND c.command_id=$4 AND c.action IN ($5,$6) AND s.data->>'binding'=$7 AND s.data->>'integrationState'=$8",
                  [
                    ctx.owner_id,
                    ctx.id,
                    frame.result.sessionId,
                    frame.result.commandId,
                    CommandActionType.CreateSession,
                    CommandActionType.RestartSession,
                    BindingState.Verified,
                    IntegrationState.Ready,
                  ],
                );

                if (frame.result.status !== CommandStatus.Dispatched || !created.rowCount) {
                  throw new Fault(ServerErrorCode.INVALID_COMMAND_RESULT);
                }
              }

              const updated = await db.pool.query(
                'UPDATE command_audit SET status=$1,code=$2,result_session_id=$6 WHERE owner_id=$3 AND device_id=$4 AND command_id=$5 AND status=$7 RETURNING command_id',
                [
                  frame.result.status,
                  frame.result.code ?? null,
                  ctx.owner_id,
                  ctx.id,
                  frame.result.commandId,
                  frame.result.sessionId ?? null,
                  CommandStatus.Accepted,
                ],
              );

              if (updated.rowCount) {
                fanout(ctx.owner_id, ctx.id, { type: FrameType.CommandResult, result: frame.result });
              }
            } else {
              throw new Fault(ErrorCode.INVALID_FRAME);
            }
          });
        })
        .catch((error) => {
          send(socket, { type: FrameType.Error, code: fault(error).code });

          if (!connection || fault(error).code === 'STALE_EPOCH') {
            socket.close(4001, 'UNAUTHORIZED');
          }
        })
        .finally(() => {
          queued--;
          queuedBytes -= bytes;
        });
    });

    socket.on('close', () => {
      clearTimeout(timeout);

      if (connection) {
        void offline(connection).catch(() => {});
      }
    });

    socket.on('error', () => {});
  });

  const timer = setInterval(() => {
    for (const connection of live.values()) {
      if (connection.lastSeen < Date.now() - 30000) {
        connection.socket.close(4000, 'OFFLINE');
        void offline(connection).catch(() => {});
      }
    }

    for (const client of clients) {
      void auth.authenticate(client.token).catch(() => client.socket.close(4001, 'TOKEN_EXPIRED'));
    }
  }, 1000);

  timer.unref();

  const retention = setInterval(() => {
    void attachments.prune().catch(() => {});

    void db.pool
      .query(
        'DELETE FROM events WHERE occurred_at<$1 OR ctid IN (SELECT ctid FROM (SELECT ctid,row_number() OVER(PARTITION BY device_id ORDER BY occurred_at DESC) AS rank FROM events) e WHERE rank>10000)',
        [Date.now() - 86400000],
      )
      .catch(() => {});

    void db.pool
      .query('UPDATE command_audit SET status=$2,code=$3 WHERE status=$4 AND created_at<$1', [
        Date.now() - 15000,
        CommandStatus.Unknown,
        ErrorCode.ACK_TIMEOUT,
        CommandStatus.Accepted,
      ])
      .catch(() => {});

    void db.pool
      .query('DELETE FROM command_audit WHERE created_at<$1', [Date.now() - 86400000])
      .catch(() => {});
  }, 10000);

  retention.unref();

  return {
    db,
    messaging,
    auth,
    devices,
    attachments,
    command,
    dispatchHandoffCreate,
    replay,
    live,
    notify,
    async listen(port = 3000, host = '127.0.0.1') {
      await app.listen(port, host);
      const address = server.address();

      return `http://${host}:${typeof address === 'object' && address ? address.port : port}`;
    },
    async close() {
      closing = true;
      sourceHistory.close();
      profileProxy.close();
      continuityProxy.close();
      clearInterval(timer);
      clearInterval(retention);

      for (const socket of [...appWss.clients, ...deviceWss.clients]) {
        socket.terminate();
      }

      appWss.close();
      deviceWss.close();
      await app.close();
      await fence.drain();
      await messaging?.close();
      await db.close();
    },
  };
}
