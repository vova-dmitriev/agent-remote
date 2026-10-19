import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { ServerFrame } from '@protocol';
import { BoundedSender } from '@transport/bounded-sender.js';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RELAY_CONFIG, type RelayConfig } from '../app/relay-config.js';
import type { Principal } from '../auth/security.js';
import { ContinuityProxy } from '../continuity/proxy.js';
import type { DeviceRecord } from '../devices/service.js';
import { SourceHistory } from '../history/source.js';
import { ProfileProxy } from '../profiles/proxy.js';
import { upgradeHandler } from './upgrade.js';

export interface DeviceConnection {
  socket: WebSocket;
  epoch: string;
  device: DeviceRecord;
  lastSeen: number;
}

export interface AppConnection {
  socket: WebSocket;
  principal: Principal;
  token: string;
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
  readonly deviceWss = new WebSocketServer({ noServer: true, maxPayload: 131072, perMessageDeflate: false });
  readonly appWss = new WebSocketServer({ noServer: true, maxPayload: 131072, perMessageDeflate: false });
  closing = false;

  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  readonly send = (socket: WebSocket, frame: ServerFrame) => this.sender.send(socket, frame);

  readonly fanout = (owner: string, deviceId: string, frame: ServerFrame) => {
    for (const client of this.clients) {
      if (client.principal.userId === owner && client.deviceId === deviceId) {
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

    for (const socket of [...this.appWss.clients, ...this.deviceWss.clients]) {
      socket.terminate();
    }

    this.appWss.close();
    this.deviceWss.close();
  }
}
