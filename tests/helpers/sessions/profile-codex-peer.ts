import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeControlledCodexPeer(root: string, wsModule: string) {
  const executable = join(root, 'controlled-codex.cjs');

  const source = `
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { WebSocketServer } = require(${JSON.stringify(wsModule)});
const home = process.env.CODEX_HOME;
const auth = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
const socket = process.argv.find((arg) => arg.startsWith('unix://')).slice('unix://'.length);
const eventsPath = path.join(home, 'peer-events.jsonl');
let thread;
let starts = 0;
const record = (event) => fs.appendFileSync(eventsPath, JSON.stringify({ home, ...event }) + '\\n');
const server = http.createServer();
const peers = new WebSocketServer({ server });
server.listen(socket);
peers.on('connection', (client) => {
  client.on('message', (message) => {
    const request = JSON.parse(message.toString());
    if (!request.id) return;
    let result = { data: [], nextCursor: null };
    if (request.method === 'account/read') {
      result = { requiresOpenaiAuth: true, account: { type: 'chatgpt', email: auth.email, planType: 'synthetic' } };
      record({ type: 'account', email: auth.email });
    } else if (request.method === 'model/list') {
      result = { data: auth.models.map((model) => ({ model: model.id, hidden: false, supportedReasoningEfforts: model.efforts.map((reasoningEffort) => ({ reasoningEffort })) })), nextCursor: null };
      record({ type: 'models', values: auth.models });
    } else if (request.method === 'thread/loaded/list') {
      result = { data: thread ? [thread.id] : [], nextCursor: null };
    } else if (request.method === 'thread/start') {
      starts++;
      const model = auth.actualModel || request.params.model;
      const reasoningEffort = auth.actualEffort || request.params.config?.model_reasoning_effort;
      thread = { id: 'controlled-' + auth.tokens.account_id, cwd: request.params.cwd, model, reasoningEffort, canAcceptDirectInput: true, status: { type: 'idle' }, turns: [] };
      record({ type: 'thread-start', starts, model: request.params.model, effort: request.params.config?.model_reasoning_effort, actualModel: model, actualEffort: reasoningEffort });
      if (auth.scenario === 'lost_ack') {
        client.close();
        return;
      }
      result = { thread, model, reasoningEffort };
    } else if (request.method === 'thread/read' || request.method === 'thread/resume') {
      result = { thread, model: thread?.model };
    }
    client.send(JSON.stringify({ id: request.id, result }));
  });
});
server.on('close', () => fs.writeFileSync(path.join(home, 'peer-closed'), 'closed'));
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => { fs.writeFileSync(path.join(home, 'peer-closed'), 'closed'); process.exit(0); });
};
peers.on('connection', (client) => client.once('close', shutdown));
process.on('SIGTERM', shutdown);
`;

  await writeFile(executable, source, { mode: 0o700 });
  await chmod(executable, 0o700);

  return executable;
}

export async function readPeerEvents(home: string) {
  try {
    return (await readFile(join(home, 'peer-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

export async function stopControlledPeer(pid: number | undefined, home: string) {
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The controlled test process may already have exited after the socket closed.
    }
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(join(home, 'peer-closed'));

      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (pid) {
    let exited = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          exited = true;
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (!exited) {
      throw new Error('CONTROLLED_PEER_EXIT_UNCONFIRMED');
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
}
