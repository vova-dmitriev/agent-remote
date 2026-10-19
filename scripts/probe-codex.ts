import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureManagedCodexSocket } from '../apps/daemon/src/codex/launcher.js';
import { connectCodexSocket } from '../apps/daemon/src/codex/rpc/transport.js';
import { bindCodex } from '../apps/daemon/src/codex/binding/binding.js';
import { object } from '../apps/daemon/src/codex/events.js';
import { LocalStore } from '../apps/daemon/src/monitor/store.js';
import { Monitor } from '../apps/daemon/src/monitor/monitor.js';
import { AdapterRegistry } from '../apps/daemon/src/adapters/registry.js';
import { PermissionBroker } from '../apps/daemon/src/commands/permission-broker.js';
import { Dispatcher } from '../apps/daemon/src/commands/dispatcher.js';
import type { Command } from '@protocol';

// Opt-in compatibility probe: creates a new disposable thread; never resumes a user thread.
const endpoint = await ensureManagedCodexSocket(
  process.env.CLAUDE_REMOTE_HOME ?? join(homedir(), '.claude-remote'),
);

const rpc = await connectCodexSocket(endpoint);
const store = new LocalStore(':memory:', 'synthetic-probe');
const adapters = new AdapterRegistry('synthetic-probe');
const permissions = new PermissionBroker();
const monitor = new Monitor({ deviceId: 'synthetic-probe', store, adapters, permissions });
let bound: Awaited<ReturnType<typeof bindCodex>> | undefined;
let threadId: string | undefined;

try {
  const cwd = await mkdtemp(join(tmpdir(), 'codex-remote-compatibility-'));
  const models = object(await rpc.request('model/list', {}));
  const catalog = Array.isArray(models.data) ? models.data.map(object) : [];
  const selected = catalog.find((model) => model.isDefault === true) ?? catalog[0];

  if (typeof selected?.model !== 'string') {
    throw new Error('CODEX_MODEL_UNAVAILABLE');
  }

  const started = object(
    object(
      await rpc.request('thread/start', {
        cwd,
        model: selected.model,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        ephemeral: false,
      }),
    ).thread,
  );

  if (typeof started.id !== 'string') {
    throw new Error('CODEX_THREAD_MISMATCH');
  }

  threadId = started.id;
  await rpc.request('thread/name/set', { threadId, name: 'Claude Remote disposable compatibility probe' });

  bound = await bindCodex(
    { kind: 'codex-cli', threadId, endpoint },
    { rpc, monitor, adapters, permissions, inputEnabled: true, permissionsEnabled: true },
  );

  const session = bound.session;

  const dispatcher = new Dispatcher({
    deviceId: 'synthetic-probe',
    store,
    monitor,
    adapters,
    permissions,
    inputEnabled: true,
    permissionsEnabled: true,
  });

  const dispatch = (action: Command['action']) =>
    dispatcher.dispatch({
      version: 1,
      commandId: randomUUID(),
      target: session.target,
      sessionId: session.id,
      generation: session.generation,
      expiresAt: Date.now() + 15000,
      action,
    });

  const receipt = await dispatch({
    type: 'prompt',
    text: 'Reply exactly CODEX_REMOTE_PROBE_OK. Do not use tools or read or modify any files.',
  });

  let answer = false;
  const deadline = Date.now() + 90000;

  while (Date.now() < deadline) {
    const events = store.replay({ ...store.cursor(), seq: 0 });

    answer =
      events !== 'resync_required' &&
      events.some(
        (event) =>
          event.type === 'message' &&
          object(event.payload).role === 'assistant' &&
          String(object(event.payload).text).includes('CODEX_REMOTE_PROBE_OK'),
      );

    if ((answer || session.errorCode) && session.status === 'idle') {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const report = {
    source: 'codex-cli',
    socketVerified: true,
    syntheticThread: true,
    hasTitle: !!session.title,
    promptDispatched: receipt.status === 'dispatched',
    answerObserved: answer,
    idle: session.status === 'idle',
    errorCode: session.errorCode ?? null,
  };

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/codex-compatibility.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));

  if (!answer || receipt.status !== 'dispatched') {
    process.exitCode = 1;
  }
} finally {
  bound?.close();

  if (threadId) {
    try {
      await rpc.request('thread/archive', { threadId });
    } catch {}
  }

  permissions.close();
  await rpc.close();
  store.close();
}
