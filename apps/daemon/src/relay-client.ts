import { RuntimeEvent } from './domain/runtime.js';
import {
  ErrorCode,
  FrameType,
  RELAY_PROTOCOL,
  SocketCloseCode,
  SocketCloseReason,
  serverFrameSchema,
  type DeviceFrame,
} from '@protocol';
import { BoundedSender } from '@transport/bounded-sender.js';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { validateRelayUrl } from './config.js';
import { logDebug } from './diagnostics/log.js';

export class RelayClient extends EventEmitter {
  private sender = new BoundedSender();
  private socket: WebSocket | undefined;
  private stopped = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  constructor(
    private relayUrl: string,
    private token: string,
  ) {
    super();
    validateRelayUrl(relayUrl);
  }
  connect() {
    if (this.stopped) {
      return;
    }

    const url = new URL('/ws/device', this.relayUrl);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { maxPayload: 131072, perMessageDeflate: false });

    this.socket = socket;
    const authTimeout = setTimeout(() => socket.terminate(), 5000);

    socket.on('open', () =>
      this.send({ type: FrameType.Auth, token: this.token, protocolVersion: RELAY_PROTOCOL.Current }),
    );

    socket.on('message', (raw) => {
      try {
        const frame = serverFrameSchema.parse(JSON.parse(raw.toString()));

        if (frame.type === FrameType.Authenticated) {
          clearTimeout(authTimeout);
          this.attempt = 0;
          this.heartbeat = setInterval(() => this.send({ type: FrameType.Heartbeat }), 10000);
          this.emit(RuntimeEvent.Online, frame.epoch);
        } else if (
          frame.type === FrameType.ProfilesRequest ||
          frame.type === FrameType.ProfilesCancel ||
          frame.type === FrameType.HistoryRead ||
          frame.type === FrameType.Command ||
          frame.type === FrameType.Select ||
          frame.type === FrameType.Ack
        ) {
          this.emit(RuntimeEvent.Frame, frame);
        }
      } catch {
        socket.close(SocketCloseCode.PolicyViolation, SocketCloseReason.InvalidFrame);
      }
    });

    socket.on('error', (error) => logDebug('relay-client', error));

    socket.on('close', (code) => {
      clearTimeout(authTimeout);

      if (this.heartbeat) {
        clearInterval(this.heartbeat);
      }

      this.socket = undefined;
      this.emit(RuntimeEvent.Offline);

      if (code === SocketCloseCode.Revoked) {
        this.stopped = true;
        this.emit(RuntimeEvent.Revoked);

        return;
      }

      // Reconnecting cannot help until one side is upgraded.
      if (code === SocketCloseCode.ProtocolUnsupported) {
        this.stopped = true;
        this.emit(RuntimeEvent.ProtocolUnsupported, ErrorCode.PROTOCOL_UNSUPPORTED);

        return;
      }

      if (!this.stopped) {
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(30000, 1000 * 2 ** this.attempt++) * (0.5 + Math.random() * 0.5),
        );
      }
    });
  }
  send(frame: DeviceFrame) {
    return this.socket ? this.sender.send(this.socket, frame) : false;
  }
  close() {
    this.stopped = true;

    if (this.retry) {
      clearTimeout(this.retry);
    }

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }

    this.socket?.close();
  }
}
