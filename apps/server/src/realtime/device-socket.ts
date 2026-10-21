import { Inject, Injectable } from '@nestjs/common';
import {
  CommandStatus,
  DeviceStatus,
  ErrorCode,
  FrameType,
  SocketCloseCode,
  SocketCloseReason,
  UNVERSIONED_RELAY_PROTOCOL,
  deviceFrameSchema,
  eventSchema,
  supportsRelayProtocol,
  MAX_RELAY_FRAME_BYTES,
} from '@protocol';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { MESSAGING } from '../app/relay-config.js';
import { CommandRepository } from '../commands/repositories/audit.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { SessionListSource } from '../sessions/catalog/session-list.js';
import { DeviceRequests } from '../sessions/device-requests.js';
import { ContinuityService } from '../continuity/service.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceRepository } from '../devices/repositories/devices.js';
import { DeviceService } from '../devices/service.js';
import { ServerErrorCode } from '../error-codes.js';
import { persistEvent, eventNotificationId } from '../history/events.js';
import { HistoryRepository } from '../history/repository.js';
import { SourceHistory } from '../history/source.js';
import { logWarning, reportFault } from '../http/errors/error-log.js';
import { Fault, parseClientJson, toFault } from '../http/errors/fault.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { SessionLabels } from '../sessions/labels.js';
import { SessionRepository } from '../sessions/repository.js';
import { RelayHub, type DeviceConnection } from './relay-hub.js';
import { Notifier } from '../notifications/notify.js';
import { rateLimitAlerts } from '../notifications/limits/rate-limits.js';

const DEVICE_SOCKET_CONTEXT = 'DeviceSocket';

/** One companion connection: authenticates the device, then stores its snapshots, events and command results. */
@Injectable()
export class DeviceSocket {
  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(DeviceRepository) private readonly deviceRecords: DeviceRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(HistoryRepository) private readonly history: HistoryRepository,
    @Inject(CommandRepository) private readonly commands: CommandRepository,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(SessionLabels) private readonly labels: SessionLabels,
    @Inject(ContinuityService) private readonly continuity: ContinuityService,
    @Inject(SourceHistory) private readonly sourceHistory: SourceHistory,
    @Inject(ProfileProxy) private readonly profileProxy: ProfileProxy,
    @Inject(ContinuityProxy) private readonly continuityProxy: ContinuityProxy,
    @Inject(SessionListSource) private readonly sessionList: SessionListSource,
    @Inject(DeviceRequests) private readonly requests: DeviceRequests,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  readonly connect = (socket: WebSocket) => {
    const {
      hub,
      deviceRecords,
      sessions,
      history,
      commands,
      messaging,
      devices,
      fence,
      labels,
      continuity,
      sourceHistory,
      profileProxy,
      continuityProxy,
      requests,
      sessionList,
      notifier,
    } = this;

    const { live, send, fanout } = hub;
    const { offline } = this.state;
    let connection: DeviceConnection | undefined;
    let chain = Promise.resolve();

    let queued = 0,
      queuedBytes = 0;

    const timeout = setTimeout(
      () => socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.AuthTimeout),
      5000,
    );

    socket.on('message', (raw) => {
      const bytes = Buffer.byteLength(raw as Buffer);

      if (queued >= 256 || queuedBytes + bytes > 4 * MAX_RELAY_FRAME_BYTES) {
        socket.close(SocketCloseCode.TryAgainLater, ErrorCode.QUEUE_FULL);

        return;
      }

      queued++;
      queuedBytes += bytes;

      chain = chain
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN || hub.closing) {
            return;
          }

          const frame = deviceFrameSchema.parse(parseClientJson(raw.toString()));

          if (!connection) {
            if (frame.type !== FrameType.Auth) {
              throw new Fault(ErrorCode.UNAUTHORIZED);
            }

            const protocolVersion = frame.protocolVersion ?? UNVERSIONED_RELAY_PROTOCOL;

            if (!supportsRelayProtocol(protocolVersion)) {
              send(socket, { type: FrameType.Error, code: ErrorCode.PROTOCOL_UNSUPPORTED });
              socket.close(SocketCloseCode.ProtocolUnsupported, SocketCloseReason.ProtocolUnsupported);

              return;
            }

            const found = await devices.authenticate(frame.token);

            await fence.run(found.id, async () => {
              const device = await devices.authenticate(frame.token);

              if (socket.readyState !== WebSocket.OPEN || hub.closing) {
                return;
              }

              const previous = live.get(device.id);

              connection = { socket, device, epoch: randomUUID(), lastSeen: Date.now(), protocolVersion };
              live.set(device.id, connection);

              if (previous) {
                profileProxy.disconnect(previous);
                continuityProxy.disconnect(previous);
                requests.disconnect(previous);
                sessionList.disconnect(previous);
              }

              previous?.socket.close(SocketCloseCode.Replaced, SocketCloseReason.Replaced);
              clearTimeout(timeout);

              // Only a daemon that announced a version gets one back: an older one parses this frame strictly.
              send(socket, {
                type: FrameType.Authenticated,
                epoch: connection.epoch,
                ...(frame.protocolVersion === undefined ? {} : { protocolVersion }),
              });
            });

            return;
          }

          if (frame.type === FrameType.SessionListResult) {
            sessionList.accept(connection, frame);

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

          if (
            frame.type === FrameType.FileResult ||
            frame.type === FrameType.AnalyticsResult ||
            frame.type === FrameType.RulesResult ||
            frame.type === FrameType.SkillsResult ||
            frame.type === FrameType.SessionModelResult
          ) {
            requests.accept(connection, frame);

            return;
          }

          if (frame.type === FrameType.HistoryItem || frame.type === FrameType.HistoryDone) {
            if (live.get(connection.device.id) !== connection) {
              throw new Fault(ErrorCode.STALE_EPOCH);
            }

            sourceHistory.accept(connection, frame);

            return;
          }

          return fence.run(connection.device.id, async () => {
            if (!connection) {
              return;
            }

            if (live.get(connection.device.id) !== connection) {
              throw new Fault(ErrorCode.STALE_EPOCH);
            }

            const ctx = await devices.owned(
              { userId: connection.device.owner_id, telegramId: '' },
              connection.device.id,
            );

            if (ctx.generation !== connection.device.generation) {
              throw new Fault(ErrorCode.STALE_EPOCH);
            }

            connection.lastSeen = Date.now();

            await deviceRecords.touch(ctx.owner_id, ctx.id, connection.lastSeen);

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

              await deviceRecords.transaction(async (tx) => {
                await deviceRecords.saveSnapshot(tx, ctx.owner_id, ctx.id, frame.snapshot, frame.connectors);
                await sessions.replaceAll(tx, ctx.owner_id, ctx.id, frame.snapshot.sessions);
              });

              // The owner hears once per window cycle that a plan limit is nearly used, and when it resets.
              for (const alert of rateLimitAlerts(frame.snapshot.rateLimits ?? [], Date.now())) {
                await notifier.notify(ctx.owner_id, alert.key, alert.kind, null, alert);
              }

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

              if (event.sessionId && !(await sessions.exists(ctx.owner_id, ctx.id, event.sessionId))) {
                throw new Fault(ErrorCode.NOT_FOUND);
              }

              if (await persistEvent(history, ctx.owner_id, event)) {
                fanout(ctx.owner_id, ctx.id, { type: FrameType.Event, event });
                const notificationId = eventNotificationId(ctx.owner_id, event);

                if (notificationId) {
                  void messaging?.queue.enqueue(notificationId).catch(() => {}); // ignore: the outbox reconciler re-enqueues
                }
              }

              send(socket, { type: FrameType.Ack, cursor: { streamId: event.streamId, seq: event.seq } });
            } else if (frame.type === FrameType.CommandResult) {
              if (frame.result.sessionId) {
                const created = await commands.createdSession(
                  ctx.owner_id,
                  ctx.id,
                  frame.result.sessionId,
                  frame.result.commandId,
                );

                if (frame.result.status !== CommandStatus.Dispatched || !created) {
                  throw new Fault(ServerErrorCode.INVALID_COMMAND_RESULT);
                }
              }

              const updated = await commands.recordResult({
                ownerId: ctx.owner_id,
                deviceId: ctx.id,
                commandId: frame.result.commandId,
                status: frame.result.status,
                code: frame.result.code ?? null,
                sessionId: frame.result.sessionId ?? null,
              });

              if (updated) {
                fanout(ctx.owner_id, ctx.id, { type: FrameType.CommandResult, result: frame.result });
              }
            } else {
              throw new Fault(ErrorCode.INVALID_FRAME);
            }
          });
        })
        .catch((error) => {
          const fault = reportFault(error, toFault(error), DEVICE_SOCKET_CONTEXT);

          send(socket, { type: FrameType.Error, code: fault.code });

          if (!connection || fault.code === ErrorCode.STALE_EPOCH) {
            socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.Unauthorized);
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
        requests.disconnect(connection);
        sessionList.disconnect(connection);

        void offline(connection).catch((error: unknown) =>
          logWarning(DEVICE_SOCKET_CONTEXT, error, ServerErrorCode.DEVICE_OFFLINE_FAILED),
        );
      }
    });

    socket.on('error', (error) => logWarning(DEVICE_SOCKET_CONTEXT, error, ServerErrorCode.SOCKET_ERROR));
  };
}
