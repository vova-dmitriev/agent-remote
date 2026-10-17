import { createServer } from 'node:http';
import { chmod } from 'node:fs/promises';
import { WebSocketServer, type WebSocket } from 'ws';
import { SyntheticThread, object, type Data, type Provider } from './model.js';

export async function cliProvider(path: string): Promise<Provider> {
  const model = new SyntheticThread();
  const server = createServer();
  const wss = new WebSocketServer({ server, perMessageDeflate: false });
  let accepting = true;

  const send = (frame: unknown) => {
    for (const socket of wss.clients) if (socket.readyState === 1) socket.send(JSON.stringify(frame));
  };

  model.on('notification', send);
  model.on('approval', send);

  wss.on('connection', (socket: WebSocket) => {
    if (!accepting) {
      socket.terminate();

      return;
    }

    socket.on('error', () => {});

    socket.on('message', (raw) => {
      const frame = object(JSON.parse(String(raw)));

      model.frames.push(frame);
      const params = object(frame.params);
      let result: unknown = {};

      if (!frame.method) {
        model.decisions.push({ id: frame.id, ...object(frame.result) });
        model.resolve(String(frame.id));

        return;
      }

      if (frame.method === 'initialized') return;
      if (frame.method === 'initialize') result = { userAgent: 'synthetic-codex' };
      if (frame.method === 'thread/loaded/list') result = { data: [model.threadId] };
      if (frame.method === 'thread/read' || frame.method === 'thread/resume')
        result = {
          thread: model.thread(),
          ...(frame.method === 'thread/resume' ? { model: model.modelName } : {}),
        };
      if (frame.method === 'thread/items/list')
        result = {
          data: model.turns
            .flatMap((turn) => (turn.items as Data[]).map((item) => ({ turnId: turn.turnId, item })))
            .reverse(),
          nextCursor: null,
        };
      if (frame.method === 'turn/start') result = model.start(params);

      if (frame.method === 'turn/interrupt') {
        model.interrupts.push(params);
        model.finish();
      }

      socket.send(JSON.stringify({ id: frame.id, result }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });

  await chmod(path, 0o600);

  return {
    model,
    path,
    disconnect() {
      accepting = false;
      wss.clients.forEach((socket) => socket.terminate());
    },
    resume() {
      accepting = true;
    },
    async close() {
      wss.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
