import { IntegrationState, TargetKind, SessionStatus } from '../../../../packages/protocol/src/index.js';
import { RuntimeEvent } from '../domain/runtime.js';
import { CodexMethod } from '../domain/codex.js';
import { type AttachmentService } from '../attachments/service.js';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import Sqlite from 'better-sqlite3';
import { z } from 'zod';
import { ensureManagedCodexSocket } from './launcher.js';
import { bindCodex, type CodexClient } from './binding.js';
import { connectCodexSocket } from './transport.js';
import { DesktopIpcClient } from './desktop-ipc.js';
import { DesktopCodexClient } from './desktop-client.js';
import { object } from './events.js';
import { type Monitor } from '../monitor/monitor.js';
import { type AdapterRegistry } from '../adapters/registry.js';
import { type UserInputBroker } from '../commands/user-input-broker.js';
import { type PermissionBroker } from '../commands/permission-broker.js';

export const codexConnectionSchema = z.strictObject({
  kind: z.enum([TargetKind.CodexCli, TargetKind.CodexDesktop]),
  socketPath: z.string().min(1).max(4096).refine(isAbsolute),
  threadId: z.string().min(1).max(512).optional(),
});
export type CodexConnection = z.infer<typeof codexConnectionSchema>;
interface Dependencies {
  monitor: Monitor;
  adapters: AdapterRegistry;
  permissions: PermissionBroker;
  userInputs?: UserInputBroker;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  stateDirectory: string;
  codexHome?: string;
  attachments?: AttachmentService;
}
interface Connection {
  selection: CodexConnection;
  discover: boolean;
  requested: Set<string>;
  rpc?: CodexClient;
  ipc?: DesktopIpcClient;
  bindings: Map<string, { close: () => void | Promise<void> }>;
  clients: Map<string, CodexClient>;
}
export class CodexManager {
  private connections = new Map<string, Connection>();
  private saved = new Map<string, CodexConnection>();
  private closed = false;
  private scanning: Promise<void> = Promise.resolve();
  private reading = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private deps: Dependencies) {}
  async start() {
    const home = this.deps.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
    let saved: CodexConnection[] = [];

    try {
      saved = z
        .array(codexConnectionSchema)
        .max(10)
        .parse(JSON.parse(await readFile(join(this.deps.stateDirectory, 'codex-connections.json'), 'utf8')));
    } catch {}

    for (const selection of saved) {
      this.saved.set(JSON.stringify(selection), selection);
    }

    for (const selection of [
      { kind: TargetKind.CodexDesktop, socketPath: join(home, 'ipc/ipc.sock') },
      { kind: TargetKind.CodexCli, socketPath: join(home, 'app-server-control/app-server-control.sock') },
      { kind: TargetKind.CodexCli, socketPath: join(this.deps.stateDirectory, 'codex/app-server.sock') },
      ...saved,
    ]) {
      this.add(selection);
    }

    this.poll();
    this.timer = setInterval(() => this.poll(), 3000);
  }
  async connect(raw: unknown) {
    const selection = codexConnectionSchema.parse(raw);

    return this.enqueue(async () => {
      if (this.closed) {
        throw new Error('CODEX_DISCONNECTED');
      }

      const savedKey = JSON.stringify(selection);

      if (!this.saved.has(savedKey) && this.saved.size >= 10) {
        throw new Error('CODEX_QUEUE_FULL');
      }

      const entry = this.add(selection);

      await this.refresh(entry);
      const count = entry.bindings.size;

      if (selection.threadId && !entry.bindings.has(selection.threadId)) {
        throw new Error('CODEX_THREAD_NOT_LOADED');
      }

      await mkdir(this.deps.stateDirectory, { recursive: true, mode: 0o700 });

      const path = join(this.deps.stateDirectory, 'codex-connections.json'),
        temporary = path + '.tmp';

      this.saved.set(savedKey, selection);
      await writeFile(temporary, JSON.stringify([...this.saved.values()]), { mode: 0o600 });
      await rename(temporary, path);

      return { connected: count, kind: selection.kind };
    });
  }
  async createSession(cwd: string): Promise<string> {
    return this.enqueue(async () => {
      if (this.closed || !this.deps.inputEnabled) {
        throw new Error('CAPABILITY_UNAVAILABLE');
      }

      const socketPath = await ensureManagedCodexSocket(this.deps.stateDirectory);
      const entry = this.add({ kind: TargetKind.CodexCli, socketPath });

      await this.refresh(entry);

      if (
        this.deps.monitor
          .snapshot()
          .sessions.filter(
            (session) =>
              session.status !== SessionStatus.Ended &&
              session.integrationState !== IntegrationState.Disconnected,
          ).length >= 10
      ) {
        throw new Error('SESSION_QUOTA');
      }

      let threadId: string;

      try {
        const response = object(await entry.rpc!.request('thread/start', { cwd }));
        const thread = object(response.thread);

        if (typeof thread.id !== 'string') {
          throw new Error();
        }

        threadId = thread.id;
      } catch {
        throw new Error('UNKNOWN_AFTER_WRITE');
      }

      entry.requested.add(threadId);

      try {
        await this.refresh(entry);

        const session = this.deps.monitor
          .snapshot()
          .sessions.find(
            (session) =>
              session.target.kind === TargetKind.CodexCli &&
              session.target.threadId === threadId &&
              session.integrationState === IntegrationState.Ready,
          );

        if (session) {
          return session.id;
        }
      } catch {
        /* A created thread must never be automatically created again. */
      }

      throw new Error('UNKNOWN_AFTER_WRITE');
    });
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.scanning;

    for (const entry of this.connections.values()) {
      for (const binding of entry.bindings.values()) {
        await binding.close();
      }

      for (const client of entry.clients.values()) {
        await client.close();
      }

      await entry.rpc?.close();
      await entry.ipc?.close();
    }

    this.connections.clear();
  }
  private add(selection: CodexConnection) {
    const key = JSON.stringify([selection.kind, selection.socketPath]);
    const existing = this.connections.get(key);

    if (existing) {
      if (selection.threadId) {
        existing.requested.add(selection.threadId);
      } else {
        existing.discover = true;
      }

      return existing;
    }

    if (this.connections.size >= 10) {
      throw new Error('CODEX_QUEUE_FULL');
    }

    const connection: Connection = {
      selection,
      discover: !selection.threadId,
      requested: new Set(selection.threadId ? [selection.threadId] : []),
      bindings: new Map(),
      clients: new Map(),
    };

    this.connections.set(key, connection);

    return connection;
  }
  private poll() {
    if (this.closed || this.reading) {
      return;
    }

    this.reading = true;

    void this.enqueue(async () => {
      for (const entry of this.connections.values()) {
        if (this.closed) {
          break;
        }

        try {
          await this.refresh(entry);
        } catch {}
      }
    }).finally(() => {
      this.reading = false;
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.scanning.then(operation);

    this.scanning = task.then(
      () => {},
      () => {},
    );

    return task;
  }
  private async candidates() {
    const home = this.deps.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');

    const files = (await readdir(home))
      .filter((name) => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));

    if (!files[0]) {
      return [];
    }

    const db = new Sqlite(join(home, files[0]), { readonly: true, fileMustExist: true });

    try {
      return (
        db
          .prepare(
            "SELECT id FROM threads WHERE archived=0 AND source IN ('vscode','appServer') AND originator IN ('Codex Desktop','codex_desktop') ORDER BY updated_at_ms DESC,id DESC LIMIT 20",
          )
          .all() as { id: string }[]
      ).map((row) => row.id);
    } finally {
      db.close();
    }
  }
  private async refresh(entry: Connection) {
    if (this.closed) {
      return;
    }

    const selection = entry.selection;

    const reset = () => {
      for (const binding of entry.bindings.values()) {
        void binding.close();
      }

      entry.bindings.clear();

      for (const client of entry.clients.values()) {
        void client.close();
      }

      entry.clients.clear();
      delete entry.rpc;
      delete entry.ipc;
    };

    if (selection.kind === TargetKind.CodexCli && !entry.rpc) {
      entry.rpc = await connectCodexSocket(selection.socketPath);
      entry.rpc.once(RuntimeEvent.Disconnected, reset);
    }

    if (selection.kind === TargetKind.CodexDesktop && !entry.ipc) {
      entry.ipc = await DesktopIpcClient.connect(selection.socketPath, 2500);
      entry.ipc.once(RuntimeEvent.Disconnected, reset);
    }

    let loaded: unknown = [];

    if (entry.discover) {
      loaded = entry.rpc
        ? object(await entry.rpc.request(CodexMethod.ThreadLoadedList, {})).data
        : await this.candidates();
    }

    const ids = [
      ...new Set([
        ...entry.requested,
        ...(Array.isArray(loaded) ? loaded.filter((id): id is string => typeof id === 'string') : []),
      ]),
    ];

    for (const id of ids.slice(0, 20)) {
      if (this.closed || entry.bindings.has(id)) {
        continue;
      }

      if (
        this.deps.monitor
          .snapshot()
          .sessions.filter(
            (session) =>
              session.integrationState !== IntegrationState.Disconnected &&
              session.status !== SessionStatus.Ended,
          ).length >= 10
      ) {
        break;
      }

      let client = entry.rpc;

      try {
        if (entry.ipc) {
          if (!(await entry.ipc.owner(id))) {
            continue;
          }

          client = await DesktopCodexClient.attach(entry.ipc, id);
          entry.clients.set(id, client);
        }

        if (!client) {
          continue;
        }

        const bound = await bindCodex(
          { kind: selection.kind, endpoint: selection.socketPath, threadId: id },
          { ...this.deps, rpc: client },
        );

        entry.bindings.set(id, bound);
      } catch {
        if (entry.ipc) {
          await client?.close();
          entry.clients.delete(id);
        }
      }
    }
  }
}
