import { createServer, type Socket } from 'node:net';
import { chmod } from 'node:fs/promises';
import { SyntheticThread, object, type Data, type Provider } from './model.js';

export async function desktopProvider(path: string): Promise<Provider> {
  const model = new SyntheticThread();
  const clients = new Set<Socket>();
  const followers = new Set<Socket>();
  let revision = 0;
  let accepting = true;

  const send = (socket: Socket, frame: unknown) => {
    const data = Buffer.from(JSON.stringify(frame));
    const header = Buffer.alloc(4);

    header.writeUInt32LE(data.length);
    socket.write(Buffer.concat([header, data]));
  };

  const broadcast = (socket: Socket, change: unknown) =>
    send(socket, {
      type: 'broadcast',
      version: 11,
      sourceClientId: 'synthetic-owner',
      method: 'thread-stream-state-changed',
      params: { conversationId: model.threadId, hostId: 'local', change },
    });

  model.on('change', () => {
    const baseRevision = revision++;

    const patches = Object.entries(model.snapshot()).map(([key, value]) => ({
      op: 'replace',
      path: [key],
      value,
    }));

    followers.forEach((socket) => broadcast(socket, { type: 'patches', baseRevision, revision, patches }));
  });

  const receive = (socket: Socket, frame: Data) => {
    model.frames.push(frame);
    const params = object(frame.params);

    if (frame.type === 'broadcast' && frame.method === 'thread-stream-following-changed') {
      if (params.following) {
        followers.add(socket);
        broadcast(socket, { type: 'snapshot', revision, conversationState: model.snapshot() });
      } else followers.delete(socket);

      return;
    }

    if (frame.type !== 'request') return;
    let result: unknown = {};

    if (frame.method === 'initialize') result = { clientId: 'synthetic-follower' };
    if (frame.method === 'thread-follower-start-turn')
      result = { result: model.start(object(object(params.turnStart).request)) };

    if (frame.method === 'thread-follower-interrupt-turn') {
      model.interrupts.push(params);
      model.finish();
    }

    if (String(frame.method).endsWith('approval-decision')) {
      model.decisions.push({ id: params.requestId, decision: params.decision });
      model.resolve(String(params.requestId));
    }

    if (frame.method === 'thread-follower-submit-user-input') {
      if (model.requests.some(request => request.id === params.requestId && request.method === 'item/tool/requestUserInput')) {
        const request = model.requests.find(request => request.id === params.requestId)!;
        const turn = model.turns.find(turn => turn.turnId === object(request.params).turnId);
        const answers = Object.fromEntries(Object.entries(object(object(params.response).answers)).map(([id, value]) => [id, object(value).answers]));

        if (turn) (turn.items as Data[]).push({ id: 'input-response-' + params.requestId, type: 'userInputResponse', requestId: params.requestId, completed: true, answers });
        model.decisions.push({ id: params.requestId, ...object(params.response) });
        model.resolve(String(params.requestId));
      }

      result = { ok: true };
    }

    if (frame.method === 'thread-follower-steer-turn') {
      const turn = model.turns.find(turn => turn.turnId === model.active);

      if (turn) {
        (turn.items as Data[]).push({ id: 'steering-' + model.frames.length, type: 'steeringUserMessage', status: 'accepted', input: params.input });
        model.emit('change');
      }

      result = { result: { turnId: model.active } };
    }

    send(socket, {
      type: 'response',
      requestId: frame.requestId,
      resultType: 'success',
      result,
      ...(frame.method === 'thread-owner-discovery' ? { handledByClientId: 'synthetic-owner' } : {}),
    });
  };

  const server = createServer((socket) => {
    if (!accepting) {
      socket.destroy();

      return;
    }

    clients.add(socket);
    let buffer = Buffer.alloc(0);

    socket.on('error', () => {});

    socket.on('close', () => {
      clients.delete(socket);
      followers.delete(socket);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0);
        const frame = object(JSON.parse(buffer.subarray(4, size + 4).toString()));

        buffer = buffer.subarray(size + 4);
        receive(socket, frame);
      }
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
      clients.forEach((socket) => socket.destroy());
    },
    resume() {
      accepting = true;
    },
    async close() {
      clients.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
