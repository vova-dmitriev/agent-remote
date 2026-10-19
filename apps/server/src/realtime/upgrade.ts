import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import type { RelayConfig } from '../app/relay-config.js';

/** Accepts `/ws/app` (from the public origin only) and `/ws/device` without a query string; destroys anything else. */
export const upgradeHandler =
  (config: RelayConfig, appWss: WebSocketServer, deviceWss: WebSocketServer) =>
  (req: IncomingMessage, socket: Duplex, head: Buffer) => {
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
  };
