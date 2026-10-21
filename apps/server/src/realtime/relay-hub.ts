import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MAX_RELAY_FRAME_BYTES, type ServerFrame } from '@protocol';
import { BoundedSender } from '@transport/bounded-sender.js';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import type { Principal } from '../auth/security.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import { DeviceRequests } from '../sessions/device-requests.js';
import type { DeviceRecord } from '../devices/repositories/devices.js';
import { SourceHistory } from '../history/source.js';
import { ProfileProxy } from '../profiles/transport/proxy.js';
import { upgradeHandler } from './upgrade.js';

export interface DeviceConnection {
  socket: WebSocket;
  epoch: string;
  device: DeviceRecord;
  lastSeen: number;
  /** The daemon↔relay protocol version negotiated at authentication; see `RELAY_PROTOCOL`. */
  protocolVersion: number;
}

export interface AppConnection {
  socket: WebSocket;
  principal: Principal;
  token: string;
  /** When the token expires, as authenticated; checks may only bring it closer, never extend it. */
  expiresAt: number;
  deviceId: string | null;
  sessionId: string | null;
  selected: boolean;
}

/** The only owner of the live device connections, the app clients and both WebSocket servers. */
@Injectable()
export class RelayHub {
  readonly live = new Map<string, DeviceConnection>();
  readonly clients = new Set<AppConnection>();
  readonly sender = new BoundedSender();
  readonly deviceWss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_RELAY_FRAME_BYTES,
    perMessageDeflate: false,
  });
  readonly appWss = new WebSocketServer({ noServer: true, maxPayload: 131072, perMessageDeflate: false });
  closing = false;

  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  readonly send = (socket: WebSocket, frame: ServerFrame) => this.sender.send(socket, frame);

  /** Sends to the owner's sockets on a device; a socket whose token expired gets nothing while it awaits closing. */
  readonly fanout = (owner: string, deviceId: string, frame: ServerFrame) => {
    const now = Date.now();

    for (const client of this.clients) {
      if (client.principal.userId === owner && client.deviceId === deviceId && client.expiresAt > now) {
        this.send(client.socket, frame);
      }
    }
  };

  attach(server: Server) {
    server.on('upgrade', upgradeHandler(this.config, this.appWss, this.deviceWss));
  }

  /** Stops the socket side; the caller then closes the Nest application, drains the fence and closes storage. */
  async shutdown() {
    this.closing = true;

    // Looked up here rather than injected: these services are built from `live` and `send` of this hub.
    this.moduleRef.get(SourceHistory).close();
    this.moduleRef.get(ProfileProxy).close();
    this.moduleRef.get(ContinuityProxy).close();
    this.moduleRef.get(DeviceRequests).close();

    for (const socket of [...this.appWss.clients, ...this.deviceWss.clients]) {
      socket.terminate();
    }

    this.appWss.close();
    this.deviceWss.close();
  }
}
