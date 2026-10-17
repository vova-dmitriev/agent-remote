import { EventEmitter } from 'node:events';

export type Data = Record<string, unknown>;
export type Kind = 'codex-cli' | 'codex-desktop';
export const object = (value: unknown): Data => (value && typeof value === 'object' ? (value as Data) : {});

export class SyntheticThread extends EventEmitter {
  readonly threadId = 'synthetic-codex-thread';
  readonly title = 'Synthetic Codex runtime';
  modelName = 'gpt-synthetic-runtime';
  readonly starts: Data[] = [];
  readonly decisions: Data[] = [];
  readonly interrupts: Data[] = [];
  readonly frames: Data[] = [];
  turns: Data[] = [
    {
      turnId: 'history-turn',
      status: 'completed',
      items: [
        {
          id: 'history-user',
          type: 'userMessage',
          content: [{ type: 'text', text: 'Synthetic original question' }],
        },
        { id: 'history-agent', type: 'agentMessage', text: 'Synthetic original answer' },
      ],
    },
  ];
  requests: Data[] = [];
  active: string | null = null;
  ambiguousNext = false;
  deferUserInput = false;

  snapshot() {
    return {
      id: this.threadId,
      title: this.title,
      latestModel: this.modelName,
      turns: this.turns,
      requests: this.requests,
      threadRuntimeStatus: { type: this.active ? 'active' : 'idle' },
    };
  }

  thread() {
    return {
      id: this.threadId,
      name: this.title,
      canAcceptDirectInput: true,
      status: { type: this.active ? 'active' : 'idle' },
      turns: this.turns.map((turn) => ({ ...turn, id: turn.turnId })),
    };
  }

  notify(method: string, params: Data) {
    this.emit('notification', { method, params: { threadId: this.threadId, ...params } });
  }

  start(params: Data) {
    this.starts.push(params);

    if (this.ambiguousNext) {
      this.ambiguousNext = false;

      return {};
    }

    this.active = 'live-turn-' + this.starts.length;

    const turn = {
      turnId: this.active,
      status: 'inProgress',
      params: { input: params.input },
      items: this.deferUserInput ? [] : [{ id: 'live-user', type: 'userMessage', content: params.input }],
    };

    this.turns.push(turn);
    this.notify('turn/started', { turn: { id: this.active } });
    if (turn.items[0]) this.notify('item/completed', { turnId: this.active, item: turn.items[0] });
    this.emit('change');

    return { turn: { id: this.active, status: 'inProgress' } };
  }

  stream(text: string) {
    const turn = this.turns.at(-1)!;
    const items = turn.items as Data[];
    const agent = items.find((item) => item.id === 'live-agent');
    const previous = typeof agent?.text === 'string' ? agent.text : '';

    if (agent) agent.text = previous + text;
    else items.push({ id: 'live-agent', type: 'agentMessage', text });
    this.notify('item/agentMessage/delta', { turnId: this.active, itemId: 'live-agent', delta: text });
    this.emit('change');
  }

  approval(id: string, file = false) {
    const frame = {
      id,
      method: file ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval',
      params: {
        threadId: this.threadId,
        turnId: this.active,
        itemId: id + '-item',
        command: 'echo synthetic',
        reason: 'Synthetic runtime check',
      },
    };

    this.requests.push(frame);
    this.emit('approval', frame);
    this.emit('change');
  }

  resolve(id: string) {
    this.requests = this.requests.filter((request) => request.id !== id);
    this.notify('serverRequest/resolved', { requestId: id });
    this.emit('change');
  }

  finish(error?: Data) {
    const id = this.active;
    const status = error ? 'failed' : 'completed';

    this.turns.at(-1)!.status = status;
    if (error) this.turns.at(-1)!.error = error;
    this.active = null;
    this.requests = [];
    this.notify('turn/completed', { turn: { id, status, ...(error ? { error } : {}) } });
    this.emit('change');
  }
}

export interface Provider {
  model: SyntheticThread;
  path: string;
  disconnect(): void;
  resume(): void;
  close(): Promise<void>;
}
