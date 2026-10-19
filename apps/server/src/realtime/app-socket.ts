import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ErrorCode, FrameType, SocketCloseCode, SocketCloseReason, appFrameSchema } from '@protocol';
import { WebSocket } from 'ws';
import { AuthService } from '../auth/auth-service.js';
import { hash } from '../auth/security.js';
import { SessionRevocations } from '../auth/sessions/session-revocations.js';
import { CommandDispatcher } from '../commands/command-dispatcher.js';
import { DeviceState } from '../devices/device-state.js';
import { DeviceService } from '../devices/service.js';
import { Fault, toFault } from '../http/errors/fault.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { RelayHub, type AppConnection } from './relay-hub.js';

/** One Mini App connection: authenticates, subscribes to a device, resumes events and forwards commands. */
@Injectable()
export class AppSocket implements OnModuleInit, OnModuleDestroy {
  private stopRevocations = () => {};

  constructor(
    @Inject(RelayHub) private readonly hub: RelayHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DeviceService) private readonly devices: DeviceService,
    @Inject(DeviceState) private readonly state: DeviceState,
    @Inject(CommandDispatcher) private readonly dispatcher: CommandDispatcher,
    @Inject(ProfileProxy) private readonly profileProxy: ProfileProxy,
    @Inject(SessionRevocations) private readonly revocations: SessionRevocations,
  ) {}

  /** A logout closes the app sockets of the revoked tokens at once. */
  onModuleInit() {
    const { profileProxy } = this;
    const { clients } = this.hub;

    this.stopRevocations = this.revocations.subscribe((revoked) => {
      profileProxy.cancelAuth(revoked);

      for (const client of clients) {
        if (revoked.includes(hash(client.token))) {
          client.socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.Unauthorized);
        }
      }
    });
  }

  onModuleDestroy() {
    this.stopRevocations();
  }

  readonly connect = (socket: WebSocket) => {
    const { hub, auth, devices } = this;
    const { clients, live, send } = hub;
    const { snapshot, replay } = this.state;
    const { command } = this.dispatcher;
    let client: AppConnection | undefined;
    let chain = Promise.resolve();
    let rejected = false;

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

          const frame = appFrameSchema.parse(JSON.parse(raw.toString()));

          if (!client) {
            if (frame.type !== FrameType.Auth) {
              throw new Fault(ErrorCode.UNAUTHORIZED);
            }

            const { expiresAt, ...principal } = await auth.authenticate(frame.token);

            if (socket.readyState !== WebSocket.OPEN || hub.closing) {
              return;
            }

            client = {
              socket,
              principal,
              token: frame.token,
              expiresAt,
              deviceId: null,
              sessionId: null,
              selected: false,
            };

            clients.add(client);
            clearTimeout(timeout);
            send(socket, { type: FrameType.Authenticated });

            return;
          }

          // Every request re-checks the token, so a revocation made anywhere stops the next request and the socket.
          const current = await auth.authenticate(client.token).catch((error: unknown) => {
            rejected = true;
            throw error;
          });

          client.expiresAt = Math.min(client.expiresAt, current.expiresAt);

          if (frame.type === FrameType.Subscribe) {
            await devices.owned(client.principal, frame.deviceId);
            const data = await snapshot(client.principal, frame.deviceId);

            if (frame.sessionId && !data.snapshot.sessions.some((s) => s.id === frame.sessionId)) {
              throw new Fault(ErrorCode.NOT_FOUND);
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
          send(socket, { type: FrameType.Error, code: toFault(error).code });

          if (!client) {
            socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.Unauthorized);
          } else if (rejected) {
            socket.close(SocketCloseCode.Unauthorized, SocketCloseReason.TokenExpired);
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
  };
}
