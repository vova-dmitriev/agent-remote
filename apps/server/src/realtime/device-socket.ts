import { Inject, Injectable } from '@nestjs/common';
import {
  BindingState,
  CommandActionType,
  CommandStatus,
  DeviceStatus,
  ErrorCode,
  FrameType,
  IntegrationState,
  SocketCloseCode,
  SocketCloseReason,
  deviceFrameSchema,
  eventSchema,
} from '@protocol';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { MESSAGING } from '../app/relay-config.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { ContinuityService } from '../continuity/service.js';
import { Database } from '../db/database.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceFence } from '../devices/fence.js';
import { DeviceService } from '../devices/service.js';
import { ServerErrorCode } from '../error-codes.js';
import { persistEvent, eventNotificationId } from '../history/events.js';
import { SourceHistory } from '../history/source.js';
import { Fault, toFault } from '../http/errors/fault.js';
import type { Messaging } from '../infrastructure/messaging.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { SessionLabels } from '../sessions/labels.js';
import { RelayHub, type DeviceConnection } from './relay-hub.js';

/** One companion connection: authenticates the device, then stores its snapshots, events and command results. */
@Injectable()
export class DeviceSocket {
  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING) private readonly messaging: Messaging | undefined,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceFence) private readonly fence: DeviceFence,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(SessionLabels) private readonly labels: SessionLabels,
    @Inject(ContinuityService) private readonly continuity: ContinuityService,
    @Inject(SourceHistory) private readonly sourceHistory: SourceHistory,
    @Inject(ProfileProxy) private readonly profileProxy: ProfileProxy,
    @Inject(ContinuityProxy) private readonly continuityProxy: ContinuityProxy,
  ) {}

  readonly connect = (socket: WebSocket) => {
    const {
      hub,
      db,
      messaging,
      devices,
      fence,
      labels,
      continuity,
      sourceHistory,
      profileProxy,
      continuityProxy,
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

      if (queued >= 256 || queuedBytes + bytes > 1048576) {
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

          const frame = deviceFrameSchema.parse(JSON.parse(raw.toString()));

          if (!connection) {
            if (frame.type !== FrameType.Auth) {
              throw new Fault(ErrorCode.UNAUTHORIZED);
            }

            const found = await devices.authenticate(frame.token);

            await fence.run(found.id, async () => {
              const device = await devices.authenticate(frame.token);

              if (socket.readyState !== WebSocket.OPEN || hub.closing) {
                return;
              }

              const previous = live.get(device.id);

              connection = { socket, device, epoch: randomUUID(), lastSeen: Date.now() };
              live.set(device.id, connection);

              if (previous) {
                profileProxy.disconnect(previous);
                continuityProxy.disconnect(previous);
              }

              previous?.socket.close(SocketCloseCode.Replaced, SocketCloseReason.Replaced);
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
                throw new Fault(ErrorCode.NOT_FOUND);
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
          send(socket, { type: FrameType.Error, code: toFault(error).code });

          if (!connection || toFault(error).code === ErrorCode.STALE_EPOCH) {
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
        void offline(connection).catch(() => {});
      }
    });

    socket.on('error', () => {});
  };
}
