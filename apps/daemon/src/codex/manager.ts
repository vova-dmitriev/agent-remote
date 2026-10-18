import {
  ErrorCode,
  IntegrationState,
  TargetKind,
  SessionStatus,
} from '../../../../packages/protocol/src/index.js';
import { RuntimeEvent } from '../domain/runtime.js';
import { CodexMethod } from '../domain/codex.js';
import { type AttachmentService } from '../attachments/service.js';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import Sqlite from 'better-sqlite3';
import { z } from 'zod';
import { ensureManagedCodexSocket, managedCodexChildState } from './launcher.js';
import { bindCodex, type CodexClient } from './binding.js';
import { connectCodexSocket } from './transport.js';
import { DesktopIpcClient } from './desktop-ipc.js';
import { DesktopCodexClient } from './desktop-client.js';
import { object } from './events.js';
import { retainConnectedBinding, type CodexBinding } from './lifecycle/bindings.js';
import { type Monitor } from '../monitor/monitor.js';
import { type AdapterRegistry } from '../adapters/registry.js';
import { type UserInputBroker } from '../commands/user-input-broker.js';
import { type PermissionBroker } from '../commands/permission-broker.js';
import { startProfiledCodexRuntime } from '../sessions/execution/start-profiled-codex.js';
import { ManagedCodexChildState } from './launch/types.js';
import type { ProfiledExecutionLaunch } from '../sessions/execution/types.js';
import type { CodexRpcClient } from './rpc-client.js';
import { nativeProfileIdentity } from '../profiles/native/metadata.js';
import { nativeProfileModels } from '../profiles/native/models.js';

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
  codexExecutable?: string;
  codexPrefixArguments?: readonly string[];
  executionNamespaceRoot?: string;
  attachments?: AttachmentService;
}
interface Connection {
  selection: CodexConnection;
  discover: boolean;
  requested: Set<string>;
  rpc?: CodexClient;
  ipc?: DesktopIpcClient;
  bindings: Map<string, CodexBinding>;
  clients: Map<string, CodexClient>;
  executionLeases: Map<string, ProfiledExecutionLaunch['executionLease']>;
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
        throw new Error(ErrorCode.CODEX_DISCONNECTED);
      }

      const savedKey = JSON.stringify(selection);

      if (!this.saved.has(savedKey) && this.saved.size >= 10) {
        throw new Error(ErrorCode.CODEX_QUEUE_FULL);
      }

      const entry = this.add(selection);

      await this.refresh(entry);
      const count = entry.bindings.size;

      if (selection.threadId && !entry.bindings.has(selection.threadId)) {
        throw new Error(ErrorCode.CODEX_THREAD_NOT_LOADED);
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
  async createSession(cwd: string, launch?: ProfiledExecutionLaunch): Promise<string> {
    return this.enqueue(async () => {
      if (this.closed || !this.deps.inputEnabled) {
        launch?.executionLease.releaseBeforeLaunch();
        throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      const socketPath = launch
        ? await startProfiledCodexRuntime(launch, {
            ...(this.deps.codexExecutable ? { executable: this.deps.codexExecutable } : {}),
            ...(this.deps.codexPrefixArguments ? { prefixArguments: this.deps.codexPrefixArguments } : {}),
            ...(this.deps.executionNamespaceRoot ? { namespaceRoot: this.deps.executionNamespaceRoot } : {}),
          })
        : await ensureManagedCodexSocket(this.deps.stateDirectory);

      if (launch) {
        launch.assertCurrent();
        launch.executionLease.bindSocket(socketPath);
      }

      const entry = this.add({ kind: TargetKind.CodexCli, socketPath });

      if (launch) {
        entry.executionLeases.set(launch.executionLease.id, launch.executionLease);
      }

      await this.refresh(entry);

      if (launch) {
        launch.assertCurrent();

        const identity = await nativeProfileIdentity(
          entry.rpc! as CodexRpcClient,
          launch.environment.CODEX_HOME!,
          launch.profile.authMode,
          false,
        );

        if (
          identity.accountRef !== launch.profile.identity?.accountRef ||
          identity.workspaceRef !== launch.profile.identity?.workspaceRef
        ) {
          throw new Error(ErrorCode.PROFILE_MISMATCH);
        }

        const models = await nativeProfileModels(entry.rpc! as CodexRpcClient);
        const model = models.find((candidate) => candidate.id === launch.selection.model);

        if (!model) {
          throw new Error(ErrorCode.PROFILE_MODEL_UNAVAILABLE);
        }

        if (launch.selection.effort && !model.efforts.includes(launch.selection.effort)) {
          throw new Error(ErrorCode.PROFILE_EFFORT_UNAVAILABLE);
        }

        launch.assertCurrent();
      }

      if (
        this.deps.monitor
          .snapshot()
          .sessions.filter(
            (session) =>
              session.status !== SessionStatus.Ended &&
              session.integrationState !== IntegrationState.Disconnected,
          ).length >= 10
      ) {
        throw new Error(ErrorCode.SESSION_QUOTA);
      }

      let threadId: string;

      try {
        const response = object(
          await entry.rpc!.request('thread/start', {
            cwd,
            ...(launch
              ? {
                  model: launch.selection.model,
                  ...(launch.selection.effort
                    ? { config: { model_reasoning_effort: launch.selection.effort } }
                    : {}),
                }
              : {}),
          }),
        );

        const thread = object(response.thread);

        if (typeof thread.id !== 'string') {
          throw new Error();
        }

        if (launch) {
          const actualModel = response.model ?? thread.model;

          if (actualModel !== launch.selection.model) {
            throw new Error(ErrorCode.PROFILE_MISMATCH);
          }

          const actualEffort = response.reasoningEffort ?? thread.reasoningEffort;

          if (launch.selection.effort && actualEffort !== launch.selection.effort) {
            throw new Error(ErrorCode.PROFILE_EFFORT_UNAVAILABLE);
          }
        }

        threadId = thread.id;
      } catch {
        throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
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
          if (launch) {
            try {
              launch.assertCurrent();
            } catch {
              throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
            }

            if (session.model !== launch.selection.model) {
              throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
            }
          }

          return session.id;
        }
      } catch {
        /* A created thread must never be automatically created again. */
      }

      throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE);
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
      throw new Error(ErrorCode.CODEX_QUEUE_FULL);
    }

    const connection: Connection = {
      selection,
      discover: !selection.threadId,
      requested: new Set(selection.threadId ? [selection.threadId] : []),
      bindings: new Map(),
      clients: new Map(),
      executionLeases: new Map(),
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

      entry.rpc.once(RuntimeEvent.Disconnected, () => {
        reset();
        void this.releaseExitedExecutions(entry);
      });
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
      const retained = await retainConnectedBinding(entry, id);

      if (this.closed || retained) {
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

  private async releaseExitedExecutions(entry: Connection) {
    const pid = [...entry.executionLeases.values()][0]?.processId();

    if (
      !entry.executionLeases.size ||
      !pid ||
      (await managedCodexChildState(pid)) !== ManagedCodexChildState.Exited
    ) {
      return;
    }

    for (const lease of entry.executionLeases.values()) {
      lease.releaseAfterExit();
    }

    entry.executionLeases.clear();
  }
}
