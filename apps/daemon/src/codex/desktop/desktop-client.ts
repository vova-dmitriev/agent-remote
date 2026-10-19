import { DaemonErrorCode } from '../../error-codes.js';
import {
  CodexItemStatus,
  CodexMethod,
  CodexRuntimeStatus,
  CodexItemType,
  CodexContentType,
  CodexTurnStatus,
} from '../../domain/codex/codex.js';
import { RuntimeEvent } from '../../domain/runtime.js';
import {
  CodexDesktopMethod,
  CodexDesktopHost,
  CodexInterruptMode,
  CodexTurnTrigger,
  CodexDesktopChangeType,
} from '../../domain/codex/codex-desktop.js';
import { randomUUID } from 'node:crypto';
import { CodedError, ErrorCode, validateUserInputAnswers } from '@protocol';
import { asyncReplyKeys, asyncReplyWrapper, desktopAsyncRequests } from './desktop-user-input.js';
import { EventEmitter } from 'node:events';
import { type RpcFrame } from '../rpc/rpc-client.js';
import { DesktopIpcClient, type OversizedConversation } from './desktop-ipc.js';
import { desktopTurns, desktopModel, applyDesktopPatches } from './desktop-state.js';
import { desktopItemTime } from '../history/history-times.js';
import { object, type Data } from '../events.js';

export class DesktopCodexClient extends EventEmitter {
  private state: Data = {};
  private revision = -1;
  private pending = new Map<string | number, Data>();
  private asynchronous = new Set<string | number>();
  private answered = new Set<string | number>();
  private questionReceipts = new Set<{ check: () => void; fail: () => void }>();
  private activeTurn: string | null = null;
  private ownerId: string;
  private constructor(
    private ipc: DesktopIpcClient,
    readonly threadId: string,
    owner: string,
  ) {
    super();
    this.ownerId = owner;
    ipc.on(RuntimeEvent.Broadcast, this.broadcast);
    ipc.on(RuntimeEvent.FrameTooLarge, this.frameTooLarge);
    ipc.on(RuntimeEvent.Disconnected, this.disconnected);
  }
  static async attach(ipc: DesktopIpcClient, threadId: string) {
    const owner = await ipc.owner(threadId);

    if (!owner) {
      throw new CodedError(ErrorCode.CODEX_THREAD_NOT_LOADED);
    }

    const client = new DesktopCodexClient(ipc, threadId, owner);

    try {
      await new Promise<void>((resolve, reject) => {
        const settle = () => {
          clearTimeout(timer);
          client.off(RuntimeEvent.Snapshot, ready);
          client.off(RuntimeEvent.Disconnected, lost);
        };

        const timer = setTimeout(() => {
          settle();
          reject(new CodedError(ErrorCode.CODEX_TIMEOUT));
        }, 10_000);

        const ready = () => {
          settle();
          resolve();
        };

        const lost = (error?: CodedError) => {
          settle();
          reject(error ?? new CodedError(ErrorCode.CODEX_DISCONNECTED));
        };

        client.once(RuntimeEvent.Snapshot, ready);
        client.once(RuntimeEvent.Disconnected, lost);

        ipc.broadcast(
          CodexDesktopMethod.ThreadStreamFollowingChanged,
          { hostId: CodexDesktopHost.Local, conversationId: threadId, following: true },
          owner,
        );
      });

      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  async request(method: string, params: unknown): Promise<unknown> {
    const input = object(params);

    if (method === CodexMethod.ThreadLoadedList) {
      return { data: [this.threadId] };
    }

    if (input.threadId !== this.threadId) {
      throw new CodedError(DaemonErrorCode.CODEX_THREAD_MISMATCH);
    }

    const turns = desktopTurns(this.state);

    const thread = {
      id: this.threadId,
      name: this.state.title,
      cwd: this.state.cwd,
      model: desktopModel(this.state),
      status: this.state.threadRuntimeStatus ?? {
        type: this.activeTurn ? CodexRuntimeStatus.Active : CodexRuntimeStatus.Idle,
      },
      canAcceptDirectInput: true,
      turns,
    };

    if (method === CodexMethod.ThreadRead || method === CodexMethod.ThreadResume) {
      return { thread, model: thread.model };
    }

    if (method === CodexMethod.ThreadTurnsList) {
      return { data: [...turns].reverse().slice(0, 1), nextCursor: null };
    }

    if (method === CodexMethod.ThreadItemsList) {
      return {
        data: turns
          .flatMap((turn) =>
            (turn.items as unknown[]).map((item) => ({
              turnId: turn.id,
              item,
              occurredAt: desktopItemTime(turn, item),
            })),
          )
          .slice(-500)
          .reverse(),
        nextCursor: null,
      };
    }

    if (method === CodexMethod.TurnStart) {
      const before = desktopTurns(this.state).at(-1)?.id ?? null;

      const response = object(
        await this.ipc.request(
          CodexDesktopMethod.ThreadFollowerStartTurn,
          {
            conversationId: this.threadId,
            turnStart: { request: input, context: { inheritThreadSettings: true } },
          },
          this.ownerId,
        ),
      );

      const result = object(response.result);

      if (typeof object(result.turn).id === 'string') {
        return result;
      }

      const last = desktopTurns(this.state).at(-1);

      if (last && last.id !== before) {
        return { turn: last };
      }

      throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
    }

    if (method === CodexMethod.TurnSteer) {
      if (!this.activeTurn || input.expectedTurnId !== this.activeTurn) {
        throw new CodedError(ErrorCode.STALE_SESSION);
      }

      const expectedTurnId = this.activeTurn;
      const parts = Array.isArray(input.input) ? input.input : [];

      const text = parts
        .filter((part) => object(part).type === CodexContentType.Text)
        .map((part) => object(part).text)
        .filter((part) => typeof part === 'string')
        .join('\n');

      const context = {
        prompt: text,
        addedFiles: [],
        fileAttachments: [],
        ideContext: null,
        imageAttachments: [],
      };

      // Native owner IPC selects its active turn. Verify the returned ID; never retry a mismatch.
      const response = object(
        await this.ipc.request(
          CodexDesktopMethod.ThreadFollowerSteerTurn,
          {
            conversationId: this.threadId,
            input: parts,
            restoreMessage: {
              id: randomUUID(),
              text,
              context,
              cwd: this.state.cwd,
              createdAt: Date.now(),
              responsesapiClientMetadata: { source: 'codex' },
            },
          },
          this.ownerId,
        ),
      );

      if (object(response.result).turnId !== expectedTurnId) {
        throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
      }

      return { turnId: expectedTurnId };
    }

    if (method === CodexMethod.TurnInterrupt) {
      if (input.turnId !== this.activeTurn) {
        throw new CodedError(ErrorCode.STALE_SESSION);
      }

      return this.ipc.request(
        CodexDesktopMethod.ThreadFollowerInterruptTurn,
        { conversationId: this.threadId, mode: CodexInterruptMode.UserStop, expectedTurnId: input.turnId },
        this.ownerId,
      );
    }

    throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }
  respond(id: string | number, result: unknown) {
    const request = this.pending.get(id);

    if (!request) {
      throw new CodedError(
        this.answered.has(id) ? ErrorCode.USER_INPUT_EXPIRED : ErrorCode.PERMISSION_EXPIRED,
      );
    }

    if (request.method === CodexMethod.ItemToolRequestUserInput) {
      return this.respondUserInput(id, request, result);
    }

    const approvalMethods = {
      [CodexMethod.ItemCommandExecutionRequestApproval]:
        CodexDesktopMethod.ThreadFollowerCommandApprovalDecision,
      [CodexMethod.ItemFileChangeRequestApproval]: CodexDesktopMethod.ThreadFollowerFileApprovalDecision,
    };

    const method = approvalMethods[request.method as keyof typeof approvalMethods] ?? null;

    if (!method) {
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    void this.ipc
      .request(
        method,
        { conversationId: this.threadId, requestId: id, decision: object(result).decision },
        this.ownerId,
      )
      .catch(() => this.disconnected());
  }
  pendingRequests(): RpcFrame[] {
    return [...this.pending.values()].filter(
      (request) =>
        (typeof request.id !== 'string' && typeof request.id !== 'number') || !this.answered.has(request.id),
    ) as RpcFrame[];
  }
  reject(_id: string | number) {
    /* Unsupported structured input remains available in the owning app. */
  }
  async close() {
    try {
      this.ipc.broadcast(
        CodexDesktopMethod.ThreadStreamFollowingChanged,
        { hostId: CodexDesktopHost.Local, conversationId: this.threadId, following: false },
        this.ownerId,
      );
    } catch {}

    this.ipc.off(RuntimeEvent.Broadcast, this.broadcast);
    this.ipc.off(RuntimeEvent.FrameTooLarge, this.frameTooLarge);
    this.ipc.off(RuntimeEvent.Disconnected, this.disconnected);
    this.pending.clear();

    for (const receipt of this.questionReceipts) {
      receipt.fail();
    }

    this.answered.clear();
  }
  private disconnected = (error?: CodedError) => {
    for (const receipt of this.questionReceipts) {
      receipt.fail();
    }

    this.emit(RuntimeEvent.Disconnected, error);
  };
  /** A state frame for this thread exceeded the IPC cap: only this thread loses its mirror. */
  private frameTooLarge = (conversation: OversizedConversation) => {
    if (conversation.conversationId !== this.threadId || conversation.sourceClientId !== this.ownerId) {
      return;
    }

    this.ipc.off(RuntimeEvent.Broadcast, this.broadcast);
    this.ipc.off(RuntimeEvent.FrameTooLarge, this.frameTooLarge);
    this.disconnected(new CodedError(ErrorCode.CODEX_FRAME_TOO_LARGE));
  };
  private async respondUserInput(id: string | number, request: Data, result: unknown): Promise<void> {
    const params = object(request.params);

    if (this.answered.has(id) || params.turnId !== this.activeTurn) {
      throw new CodedError(ErrorCode.USER_INPUT_EXPIRED);
    }

    const questions = params.questions as import('@protocol').UserInputQuestion[];

    const answers = validateUserInputAnswers({ questions }, object(result).answers);
    const asynchronous = this.asynchronous.has(id);

    this.answered.add(id);

    if (asynchronous && !Object.keys(answers).length) {
      return;
    }

    const turnId = this.activeTurn;

    const replies = asynchronous
      ? questions.map((question) => ({
          questionItemId: question.id,
          question: question.question,
          answer: answers[question.id]!.answers[0]!,
        }))
      : [];

    // Install the observer before sending: a native state update can precede IPC acknowledgement.
    let settle!: () => void, fail!: () => void;

    const receipt = new Promise<void>((resolve, reject) => {
      settle = resolve;
      fail = () => reject(new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE));
    });

    const watcher = {
      check: () => {
        if (asynchronous) {
          const turn = desktopTurns(this.state).find((turn) => turn.id === turnId);
          const accepted = asyncReplyKeys(Array.isArray(turn?.items) ? turn.items : []);

          if (
            replies.every((reply) =>
              accepted.has(JSON.stringify([reply.questionItemId, reply.question, reply.answer])),
            )
          ) {
            settle();
          }
        } else if (!this.pending.has(id)) {
          const turn = desktopTurns(this.state).find((turn) => turn.id === turnId);

          const expected = Object.fromEntries(
            Object.entries(answers).map(([key, value]) => [key, value.answers]),
          );

          const items: unknown[] = Array.isArray(turn?.items) ? turn.items : [];

          if (
            items.some((raw) => {
              const item = object(raw),
                received = object(item.answers);

              return (
                item.type === CodexItemType.UserInputResponse &&
                String(item.requestId) === String(id) &&
                item.completed === true &&
                Object.keys(received).length === Object.keys(expected).length &&
                Object.entries(expected).every(
                  ([key, values]) =>
                    Object.hasOwn(received, key) && JSON.stringify(received[key]) === JSON.stringify(values),
                )
              );
            })
          ) {
            settle();
          }
        }
      },
      fail,
    };

    this.questionReceipts.add(watcher);
    const timer = setTimeout(fail, 10_000);

    timer.unref();
    // Avoid unhandled rejection while awaiting the transport acknowledgement.
    void receipt.catch(() => {});

    try {
      if (asynchronous) {
        const text = asyncReplyWrapper(replies);

        const context = {
          prompt: text,
          turnTrigger: CodexTurnTrigger.AsyncQuestion,
          addedFiles: [],
          fileAttachments: [],
          ideContext: null,
          imageAttachments: [],
        };

        const response = object(
          await this.ipc.request(
            CodexDesktopMethod.ThreadFollowerSteerTurn,
            {
              conversationId: this.threadId,
              input: [{ type: CodexContentType.Text, text }],
              restoreMessage: {
                id: randomUUID(),
                text,
                context,
                cwd: this.state.cwd,
                createdAt: Date.now(),
                responsesapiClientMetadata: { source: 'codex' },
              },
            },
            this.ownerId,
          ),
        );

        if (object(response.result).turnId !== turnId) {
          throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
        }
      } else {
        const response = object(
          await this.ipc.request(
            CodexDesktopMethod.ThreadFollowerSubmitUserInput,
            { conversationId: this.threadId, requestId: id, response: { answers } },
            this.ownerId,
          ),
        );

        if (response.ok !== true) {
          throw new CodedError(ErrorCode.UNKNOWN_AFTER_WRITE);
        }
      }

      watcher.check();
      await receipt;
    } catch {
      // A native exact receipt is authoritative even if its IPC acknowledgement was lost.
      watcher.check();
      await receipt;
    } finally {
      clearTimeout(timer);
      this.questionReceipts.delete(watcher);
    }
  }
  private broadcast = (frame: Data) => {
    const params = object(frame.params);

    if (
      frame.sourceClientId !== this.ownerId ||
      params.conversationId !== this.threadId ||
      params.hostId !== CodexDesktopHost.Local
    ) {
      return;
    }

    if (frame.method !== CodexDesktopMethod.ThreadStreamStateChanged || frame.version !== 11) {
      return;
    }

    const change = object(params.change);

    if (change.type === CodexDesktopChangeType.Snapshot && typeof change.revision === 'number') {
      this.state = object(change.conversationState);
      this.revision = change.revision;
    } else if (
      change.type === CodexDesktopChangeType.Patches &&
      change.baseRevision === this.revision &&
      typeof change.revision === 'number' &&
      Array.isArray(change.patches)
    ) {
      try {
        applyDesktopPatches(this.state, change.patches);
        this.revision = change.revision;
      } catch {
        this.ipc.broadcast(
          CodexDesktopMethod.ThreadStreamFollowingChanged,
          { hostId: CodexDesktopHost.Local, conversationId: this.threadId, following: true },
          this.ownerId,
        );

        return;
      }
    } else {
      this.ipc.broadcast(
        CodexDesktopMethod.ThreadStreamFollowingChanged,
        { hostId: CodexDesktopHost.Local, conversationId: this.threadId, following: true },
        this.ownerId,
      );

      return;
    }

    this.emit(RuntimeEvent.Snapshot);

    const turns = desktopTurns(this.state),
      active = turns.findLast((turn) => turn.status === CodexTurnStatus.InProgress);

    const activeId = active && typeof active.id === 'string' ? active.id : null;

    if (this.activeTurn && this.activeTurn !== activeId) {
      const ended = turns.find((turn) => turn.id === this.activeTurn);

      this.emit(RuntimeEvent.Notification, {
        method: CodexMethod.TurnCompleted,
        params: {
          threadId: this.threadId,
          turn: ended ?? { id: this.activeTurn, status: CodexTurnStatus.Completed },
        },
      });
    }

    if (activeId && activeId !== this.activeTurn) {
      this.emit(RuntimeEvent.Notification, {
        method: CodexMethod.TurnStarted,
        params: { threadId: this.threadId, turn: { id: activeId } },
      });
    }

    this.activeTurn = activeId;

    this.emit(RuntimeEvent.Notification, {
      method: CodexMethod.ThreadModelUpdated,
      params: { threadId: this.threadId, model: desktopModel(this.state) },
    });

    this.emit(RuntimeEvent.Notification, {
      method: CodexMethod.ThreadNameUpdated,
      params: { threadId: this.threadId, threadName: this.state.title },
    });

    this.emit(RuntimeEvent.Notification, {
      method: CodexMethod.ThreadStatusChanged,
      params: {
        threadId: this.threadId,
        status: this.state.threadRuntimeStatus ?? {
          type: activeId ? CodexRuntimeStatus.Active : CodexRuntimeStatus.Idle,
        },
      },
    });

    for (const { turn, item } of turns
      .flatMap((turn) => (turn.items as unknown[]).map((item) => ({ turn, item })))
      .slice(-500)) {
      this.emit(RuntimeEvent.Notification, {
        method:
          turn.id === activeId && object(item).status === CodexItemStatus.InProgress
            ? CodexMethod.ItemStarted
            : CodexMethod.ItemCompleted,
        params: { threadId: this.threadId, turnId: turn.id, item },
      });
    }

    const nativeRequests = Array.isArray(this.state.requests) ? this.state.requests : [];
    const nativeIds = new Set(nativeRequests.map((request) => object(request).id));
    const asynchronousRequests = desktopAsyncRequests(turns).filter((request) => !nativeIds.has(request.id));

    this.asynchronous = new Set(asynchronousRequests.map((request) => request.id as string));

    const requests = [
      ...nativeRequests,
      ...asynchronousRequests.map((request) => ({
        ...request,
        params: { ...object(request.params), threadId: this.threadId },
      })),
    ];

    const current = new Set(requests.map((raw) => object(raw).id));

    for (const id of this.pending.keys()) {
      if (!current.has(id)) {
        this.pending.delete(id);
        this.answered.delete(id);

        this.emit(RuntimeEvent.Notification, {
          method: CodexMethod.ServerRequestResolved,
          params: { threadId: this.threadId, requestId: id },
        });
      }
    }

    for (const watcher of this.questionReceipts) {
      watcher.check();
    }

    for (const raw of requests) {
      const request = object(raw);
      const id = request.id;

      if ((typeof id === 'string' || typeof id === 'number') && !this.pending.has(id)) {
        this.pending.set(id, request);
        this.emit(RuntimeEvent.Request, request);
      }
    }
  };
}
