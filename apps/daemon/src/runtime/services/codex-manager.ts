import {
  AgentProvider,
  CodedError,
  ErrorCode,
  IntegrationState,
  type ModelChoice,
  TargetKind,
} from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { CodexMethod, CodexOriginator } from '../../domain/codex/codex.js';
import { type AttachmentService } from '../../attachments/service.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import Sqlite from 'better-sqlite3';
import { z } from 'zod';
import { ensureManagedCodexSocket, managedCodexChildState } from '../../codex/launcher.js';
import { bindCodex } from '../../codex/binding/binding.js';
import type { CodexClient } from '../../domain/codex/client.js';
import { connectCodexSocket } from '../../codex/rpc/transport.js';
import { DesktopIpcClient } from '../../codex/desktop/desktop-ipc.js';
import { DesktopCodexClient } from '../../codex/desktop/desktop-client.js';
import { object } from '../../codex/events.js';
import { retainConnectedBinding, type CodexBinding } from '../../codex/lifecycle/bindings.js';
import { markCodexThreadTooLarge } from '../../codex/lifecycle/too-large.js';
import { type Monitor } from '../../monitor/monitor.js';
import { type AdapterRegistry } from '../../adapters/registry.js';
import { type UserInputBroker } from '../../commands/user-input-broker.js';
import { type PermissionBroker } from '../../commands/permission-broker.js';
import { startProfiledCodexRuntime } from '../../sessions/execution/start-profiled-codex.js';
import { ManagedCodexChildState } from '../../codex/launch/types.js';
import type { ProfiledExecutionLaunch } from '../../sessions/execution/types.js';
import type { CodexRpcClient } from '../../codex/rpc/rpc-client.js';
import { nativeProfileIdentity } from '../../profiles/native/metadata.js';
import { nativeProfileModels } from '../../profiles/native/models.js';
import { codexConnectionSchema, type CodexConnection } from '../../domain/codex/connection.js';
import { logDebug } from '../../diagnostics/log.js';

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
  /** One of several users' daemons on a shared machine: follow only this daemon's own Codex app-server. */
  ownAppServerOnly?: boolean;
}
interface Connection {
  selection: CodexConnection;
  discover: boolean;
  requested: Set<string>;
  /** Threads this connection started: it follows them without resuming. */
  started: Set<string>;
  rpc?: CodexClient;
  ipc?: DesktopIpcClient;
  bindings: Map<string, CodexBinding>;
  clients: Map<string, CodexClient>;
  executionLeases: Map<string, ProfiledExecutionLaunch['executionLease']>;
}

/** A thread's model and reasoning effort as `thread/start` takes them; none keeps the Codex home's defaults. */
function modelOverrides(choice: ModelChoice | undefined) {
  return choice
    ? { model: choice.model, ...(choice.effort ? { config: { model_reasoning_effort: choice.effort } } : {}) }
    : {};
}

export class CodexManager {
  private connections = new Map<string, Connection>();
  /** App-servers of the device's own Codex sign-in, whose models the app offers. */
  private nativeSockets = new Set<string>();
  private saved = new Map<string, CodexConnection>();
  /**
   * Codex Desktop's threads by who follows them: Codex Desktop itself (`hosted`), or, while it does not (the app is
   * closed), this daemon's own app-server (`orphans`).
   */
  private desktopThreads = { hosted: new Set<string>(), orphans: new Set<string>() };
  /** The app-server this daemon starts for the sessions it creates. */
  private get ownSocket() {
    return join(this.deps.stateDirectory, 'codex/app-server.sock');
  }
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
    } catch (error) {
      logDebug('runtime/services/codex-manager', error);
    }

    for (const selection of saved) {
      this.saved.set(JSON.stringify(selection), selection);
    }

    const own = { kind: TargetKind.CodexCli, socketPath: this.ownSocket };

    // A user's daemon on a shared machine follows only its own app-server: the machine's shared one and Codex
    // Desktop hold every user's threads.
    const native = this.deps.ownAppServerOnly
      ? [own]
      : [
          { kind: TargetKind.CodexCli, socketPath: join(home, 'app-server-control/app-server-control.sock') },
          own,
        ];

    for (const selection of native) {
      this.nativeSockets.add(selection.socketPath);
    }

    const desktop = this.deps.ownAppServerOnly
      ? []
      : [{ kind: TargetKind.CodexDesktop, socketPath: join(home, 'ipc/ipc.sock') }];

    for (const selection of [...desktop, ...native, ...(this.deps.ownAppServerOnly ? [] : saved)]) {
      this.add(selection);
    }

    this.poll();
    this.timer = setInterval(() => this.poll(), 3000);
  }
  async connect(raw: unknown) {
    const selection = codexConnectionSchema.parse(raw);

    return this.enqueue(async () => {
      if (this.closed) {
        throw new CodedError(ErrorCode.CODEX_DISCONNECTED);
      }

      const savedKey = JSON.stringify(selection);

      if (!this.saved.has(savedKey) && this.saved.size >= 10) {
        throw new CodedError(ErrorCode.CODEX_QUEUE_FULL);
      }

      const entry = this.add(selection);

      await this.refresh(entry);
      const count = entry.bindings.size;

      if (selection.threadId && !entry.bindings.has(selection.threadId)) {
        throw new CodedError(ErrorCode.CODEX_THREAD_NOT_LOADED);
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
  /** Continues a Codex thread by its id on this daemon's own app-server, unless Codex Desktop already hosts it. */
  async resumeThread(threadId: string): Promise<string> {
    return this.enqueue(async () => {
      if (this.closed || !this.deps.inputEnabled) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      const entry = this.add({
        kind: TargetKind.CodexCli,
        socketPath: await ensureManagedCodexSocket(this.deps.stateDirectory),
      });

      await this.refresh(entry);

      if (!this.desktopThreads.hosted.has(threadId)) {
        try {
          await entry.rpc!.request(CodexMethod.ThreadResume, { threadId, excludeTurns: true });
        } catch (error) {
          logDebug('codex/resume-thread', error);
          throw new CodedError(ErrorCode.NOT_FOUND);
        }

        entry.requested.add(threadId);
        await this.refresh(entry);
      }

      const session = this.deps.monitor
        .snapshot()
        .sessions.find(
          (candidate) => 'threadId' in candidate.target && candidate.target.threadId === threadId,
        );

      if (!session) {
        throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
      }

      return session.id;
    });
  }
  async createSession(cwd: string, launch?: ProfiledExecutionLaunch, choice?: ModelChoice): Promise<string> {
    return this.enqueue(async () => {
      if (this.closed || !this.deps.inputEnabled) {
        launch?.executionLease.releaseBeforeLaunch();
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      // The device's one session limit, checked before any Codex process starts.
      if (!this.deps.monitor.canCreateSession()) {
        launch?.executionLease.releaseBeforeLaunch();
        throw new CodedError(ErrorCode.SESSION_QUOTA);
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
          throw new CodedError(ErrorCode.PROFILE_MISMATCH);
        }

        const models = await nativeProfileModels(entry.rpc! as CodexRpcClient);
        const model = models.find((candidate) => candidate.id === launch.selection.model);

        if (!model) {
          throw new CodedError(ErrorCode.PROFILE_MODEL_UNAVAILABLE);
        }

        if (launch.selection.effort && !model.efforts.includes(launch.selection.effort)) {
          throw new CodedError(ErrorCode.PROFILE_EFFORT_UNAVAILABLE);
        }

        launch.assertCurrent();
      }

      let threadId: string;

      try {
        const response = object(
          await entry.rpc!.request('thread/start', {
            cwd,
            ...modelOverrides(launch?.selection ?? choice),
          }),
        );

        const thread = object(response.thread);

        if (typeof thread.id !== 'string') {
          throw new Error();
        }

        if (launch) {
          const actualModel = response.model ?? thread.model;

          if (actualModel !== launch.selection.model) {
            throw new CodedError(ErrorCode.PROFILE_MISMATCH);
          }

          const actualEffort = response.reasoningEffort ?? thread.reasoningEffort;

          if (launch.selection.effort && actualEffort !== launch.selection.effort) {
            throw new CodedError(ErrorCode.PROFILE_EFFORT_UNAVAILABLE);
          }
        }

        threadId = thread.id;
      } catch (error) {
        logDebug('codex/create-session', error);
        throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
      }

      entry.requested.add(threadId);
      entry.started.add(threadId);

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
              throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
            }

            if (session.model !== launch.selection.model) {
              throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
            }
          }

          return session.id;
        }

        logDebug('codex/create-session', new CodedError(ErrorCode.SESSION_UNAVAILABLE));
      } catch (error) {
        logDebug('codex/create-session', error); // a created thread must never be automatically created again.
      }

      throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
    });
  }
  /**
   * Names a thread through an app-server (`thread/name/set`), which writes it to the Codex home's name index: the one
   * serving the thread, else any connected one (a Codex desktop thread shares the home). False with no app-server.
   */
  async renameThread(threadId: string, name: string): Promise<boolean> {
    const servers = [...this.connections.values()].filter((item) => item.rpc && !item.ipc);
    const entry = servers.find((item) => item.bindings.has(threadId)) ?? servers[0];

    if (!entry?.rpc) {
      return false;
    }

    await entry.rpc.request(CodexMethod.ThreadNameSet, { threadId, name });

    return true;
  }
  /** Archives a thread through an app-server, like `renameThread`; Codex moves it out of its thread list. */
  async archiveThread(threadId: string): Promise<void> {
    const servers = [...this.connections.values()].filter((item) => item.rpc && !item.ipc);
    const entry = servers.find((item) => item.bindings.has(threadId)) ?? servers[0];

    if (!entry?.rpc) {
      throw new CodedError(ErrorCode.CODEX_DISCONNECTED);
    }

    await entry.rpc.request(CodexMethod.ThreadArchive, { threadId });
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
      throw new CodedError(ErrorCode.CODEX_QUEUE_FULL);
    }

    const connection: Connection = {
      selection,
      discover: !selection.threadId,
      requested: new Set(selection.threadId ? [selection.threadId] : []),
      started: new Set(),
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
        } catch (error) {
          logDebug('runtime/services/codex-manager', error);
        }
      }
    }).finally(() => {
      this.reading = false;
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.scanning.then(operation);

    this.scanning = task.then(
      () => {},
      (error: unknown) => logDebug('runtime/services/codex-manager', error),
    );

    return task;
  }
  /** Who follows a Codex Desktop thread: Codex Desktop while it hosts it, else this daemon's own app-server. */
  private followDesktopThread(id: string, hosted: boolean) {
    const { hosted: inDesktop, orphans } = this.desktopThreads;

    (hosted ? inDesktop : orphans).add(id);
    (hosted ? orphans : inDesktop).delete(id);
  }
  /**
   * Loads into this daemon's own app-server the threads it started that Codex unloaded, and Codex Desktop's threads
   * while Codex Desktop does not host them; returns those now loaded.
   */
  private async reload(rpc: NonNullable<Connection['rpc']>, loaded: unknown) {
    const reloaded: string[] = [];

    const started = await this.candidates([CodexOriginator.Remote]).catch((error: unknown) => {
      logDebug('runtime/services/codex-manager', error);

      return [];
    });

    for (const id of new Set([...started, ...this.desktopThreads.orphans])) {
      if (Array.isArray(loaded) && loaded.includes(id)) {
        continue;
      }

      try {
        await rpc.request(CodexMethod.ThreadResume, { threadId: id, excludeTurns: true });
        reloaded.push(id);
      } catch (error) {
        logDebug('runtime/services/codex-manager', error);
      }
    }

    return reloaded;
  }
  /** The newest unarchived threads the given originators started, from Codex's state database. */
  private async candidates(originators: readonly string[]) {
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
            "SELECT id FROM threads WHERE archived=0 AND source IN ('vscode','appServer') AND originator IN (SELECT value FROM json_each(?)) ORDER BY updated_at_ms DESC,id DESC LIMIT 20",
          )
          .all(JSON.stringify(originators)) as { id: string }[]
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

      if (this.nativeSockets.has(selection.socketPath)) {
        void nativeProfileModels(entry.rpc as CodexRpcClient).then(
          (models) => this.deps.monitor.setProviderModels(AgentProvider.Codex, models),
          (error: unknown) => logDebug('runtime/services/codex-manager', error),
        );
      }
    }

    if (selection.kind === TargetKind.CodexDesktop && !entry.ipc) {
      try {
        entry.ipc = await DesktopIpcClient.connect(selection.socketPath, 2500);
      } catch (error) {
        // Codex Desktop is closed: its threads go on in this daemon's own app-server.
        for (const id of await this.candidates([CodexOriginator.Desktop, CodexOriginator.DesktopLegacy])) {
          this.followDesktopThread(id, false);
        }

        throw error;
      }

      entry.ipc.once(RuntimeEvent.Disconnected, reset);
    }

    let loaded: unknown = [];

    if (entry.discover) {
      loaded = entry.rpc
        ? object(await entry.rpc.request(CodexMethod.ThreadLoadedList, {})).data
        : await this.candidates([CodexOriginator.Desktop, CodexOriginator.DesktopLegacy]);
    }

    // Codex unloads a thread nobody follows, so after a restart the threads this app started on its own app-server
    // are found where Codex records them, and loaded again.
    if (entry.discover && entry.rpc && selection.socketPath === this.ownSocket) {
      loaded = [...(Array.isArray(loaded) ? loaded : []), ...(await this.reload(entry.rpc, loaded))].filter(
        (id) => !this.desktopThreads.hosted.has(id),
      );

      // A thread Codex Desktop took back is followed there, not here.
      for (const id of this.desktopThreads.hosted) {
        const binding = entry.bindings.get(id);

        if (binding) {
          entry.bindings.delete(id);
          await binding.close();
        }
      }
    }

    const ids = [
      ...new Set([
        ...entry.requested,
        ...(Array.isArray(loaded) ? loaded.filter((id): id is string => typeof id === 'string') : []),
      ]),
    ];

    for (const id of ids.slice(0, 20)) {
      const retained = await retainConnectedBinding(entry, id);

      if (retained && entry.ipc) {
        this.followDesktopThread(id, true);
      }

      if (this.closed || retained) {
        continue;
      }

      // The device's one session limit: binding a thread adds a session.
      if (!this.deps.monitor.canCreateSession()) {
        break;
      }

      let client = entry.rpc;
      let owner: string | null = null;
      const thread = { kind: selection.kind, endpoint: selection.socketPath, threadId: id };

      try {
        if (entry.ipc) {
          owner = await entry.ipc.owner(id);
          this.followDesktopThread(id, !!owner);

          if (!owner) {
            continue;
          }

          // Each attach makes Codex resend the whole snapshot; wait for the mark's retry time.
          if (entry.ipc.frameTooLarge(id, owner)) {
            markCodexThreadTooLarge(thread, this.deps);
            continue;
          }

          client = await DesktopCodexClient.attach(entry.ipc, id);
          entry.clients.set(id, client);
        }

        if (!client) {
          continue;
        }

        const bound = await bindCodex(
          { ...thread, ...(entry.started.has(id) && !entry.ipc ? { started: true } : {}) },
          { ...this.deps, rpc: client },
        );

        entry.bindings.set(id, bound);
      } catch {
        if (entry.ipc) {
          await client?.close();
          entry.clients.delete(id);

          if (owner && entry.ipc?.frameTooLarge(id, owner)) {
            markCodexThreadTooLarge(thread, this.deps);
          }
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
