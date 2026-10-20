import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DesktopCodexClient } from '../../../../apps/daemon/src/codex/desktop/desktop-client.js';
import type { DesktopIpcClient } from '../../../../apps/daemon/src/codex/desktop/desktop-ipc.js';
import type { Data } from '../../../../apps/daemon/src/codex/events.js';

const question = {
  id: 'q',
  header: 'Color',
  question: 'Choose a color',
  isOther: true,
  isSecret: false,
  options: [{ label: 'Blue', description: 'Color' }],
};

class Ipc extends EventEmitter {
  state: Data = {
    cwd: '/synthetic',
    requests: [
      {
        id: 'sync',
        method: 'item/tool/requestUserInput',
        params: { threadId: 'thread', turnId: 'turn', itemId: 'item', questions: [question] },
      },
    ],
    turns: [{ turnId: 'turn', status: 'inProgress', items: [] }],
  };
  calls: { method: string; params: Data; owner: unknown }[] = [];
  handler: (method: string, params: Data) => unknown = () => ({ ok: true });
  async owner() {
    return 'owner';
  }
  broadcast(_method: string, params: Data) {
    if (params.following) {
      this.snapshot();
    }
  }
  async request(method: string, params: Data, owner: unknown) {
    this.calls.push({ method, params, owner });

    return this.handler(method, params);
  }
  snapshot() {
    this.emit('broadcast', {
      method: 'thread-stream-state-changed',
      version: 11,
      sourceClientId: 'owner',
      params: {
        conversationId: 'thread',
        hostId: 'local',
        change: { type: 'snapshot', revision: 1, conversationState: structuredClone(this.state) },
      },
    });
  }
}
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
  vi.useRealTimers();
});

async function fixture() {
  const ipc = new Ipc();
  const client = await DesktopCodexClient.attach(ipc as unknown as DesktopIpcClient, 'thread');

  cleanup.push(() => client.close());

  return { ipc, client };
}

it('uses exact sync IPC response and waits for native resolution beyond owner ok acknowledgement', async () => {
  const { ipc, client } = await fixture();
  let done = false;

  const reply = Promise.resolve(client.respond('sync', { answers: { q: { answers: ['Blue'] } } })).then(
    () => {
      done = true;
    },
  );

  await Promise.resolve();
  await Promise.resolve();

  expect(ipc.calls[0]).toEqual({
    method: 'thread-follower-submit-user-input',
    params: {
      conversationId: 'thread',
      requestId: 'sync',
      response: { answers: { q: { answers: ['Blue'] } } },
    },
    owner: 'owner',
  });

  expect(done).toBe(false);
  ipc.state.requests = [];

  ipc.state.turns = [
    {
      turnId: 'turn',
      status: 'inProgress',
      items: [
        {
          id: 'receipt',
          type: 'userInputResponse',
          requestId: 'sync',
          completed: true,
          answers: { q: ['Blue'] },
        },
      ],
    },
  ];

  ipc.snapshot();
  await reply;
  expect(done).toBe(true);
});

it('does not claim dispatch for an owner no-op or repeat an uncertain submission', async () => {
  vi.useFakeTimers();
  const { ipc, client } = await fixture();
  const reply = Promise.resolve(client.respond('sync', { answers: {} }));
  const rejected = expect(reply).rejects.toThrow('UNKNOWN_AFTER_WRITE');

  await vi.advanceTimersByTimeAsync(10001);
  await rejected;

  await expect(Promise.resolve().then(() => client.respond('sync', { answers: {} }))).rejects.toThrow(
    'USER_INPUT_EXPIRED',
  );

  expect(ipc.calls).toHaveLength(1);
});

it('captures async questions and steers the verified native wrapper, accepting only confirmed user replies', async () => {
  const { ipc, client } = await fixture();

  ipc.state.requests = [];

  const item = {
    id: 'async-item',
    type: 'agentMessage',
    delivery: 'async',
    text: '',
    questions: [{ title: 'Select direction', options: ['Left', 'Right'] }],
  };

  ipc.state.turns = [{ turnId: 'turn', status: 'inProgress', items: [item] }];
  ipc.snapshot();
  const pending = client.pendingRequests()[0]!;
  const qid = JSON.stringify(['request_user_input_async', 'async-item', 0]);

  expect((pending.params as Data).isBlocking).toBe(false);

  expect((pending.params as Data).questions).toEqual([
    {
      id: qid,
      header: 'Question',
      question: 'Select direction',
      isOther: true,
      isSecret: false,
      options: [
        { label: 'Left', description: '' },
        { label: 'Right', description: '' },
      ],
    },
  ]);

  ipc.handler = () => ({ result: { turnId: 'turn' } });
  let done = false;

  const reply = Promise.resolve(
    client.respond(pending.id!, { answers: { [qid]: { answers: ['Right'] } } }),
  ).then(() => {
    done = true;
  });

  await Promise.resolve();

  const wrapper =
    '<send_user_message_question_reply>\n' +
    JSON.stringify([{ questionItemId: qid, question: 'Select direction', answer: 'Right' }]) +
    '\n</send_user_message_question_reply>';

  expect(ipc.calls[0]!.method).toBe('thread-follower-steer-turn');
  expect(ipc.calls[0]!.params.input).toEqual([{ type: 'text', text: wrapper }]);

  expect((ipc.calls[0]!.params.restoreMessage as Data).context).toMatchObject({
    prompt: wrapper,
    turnTrigger: 'send_user_message_async_question',
  });

  const steering = {
    id: 'reply',
    type: 'steeringUserMessage',
    input: [{ type: 'text', text: wrapper }],
    status: 'pending',
  };

  ipc.state.turns = [{ turnId: 'turn', status: 'inProgress', items: [item, steering] }];
  ipc.snapshot();
  expect(done).toBe(false);
  steering.status = 'accepted';
  ipc.snapshot();
  await reply;
  expect(client.pendingRequests()).toEqual([]);
});

it('async Skip suppresses only the local question without any native response', async () => {
  const { ipc, client } = await fixture();

  ipc.state.requests = [];

  ipc.state.turns = [
    {
      turnId: 'turn',
      status: 'inProgress',
      items: [
        {
          id: 'a',
          type: 'agentMessage',
          delivery: 'async',
          questions: [{ title: 'Free text', options: [] }],
        },
      ],
    },
  ];

  ipc.snapshot();
  const pending = client.pendingRequests()[0]!;

  await client.respond(pending.id!, { answers: {} });
  ipc.snapshot();
  expect(client.pendingRequests()).toEqual([]);
  expect(ipc.calls).toEqual([]);
});

it('answers nonblocking native RPC requests through submit-user-input, including explicit Skip', async () => {
  const { ipc, client } = await fixture();
  const native = (ipc.state.requests as Data[])[0]!;

  native.id = 'sync-nonblocking';
  (native.params as Data).isBlocking = false;
  ipc.snapshot();

  ipc.handler = () => {
    ipc.state.requests = [];

    ipc.state.turns = [
      {
        turnId: 'turn',
        status: 'inProgress',
        items: [
          {
            id: 'receipt',
            type: 'userInputResponse',
            requestId: 'sync-nonblocking',
            completed: true,
            answers: {},
          },
        ],
      },
    ];

    ipc.snapshot();

    return { ok: true };
  };

  await client.respond('sync-nonblocking', { answers: {} });

  expect(ipc.calls).toEqual([
    {
      method: 'thread-follower-submit-user-input',
      params: { conversationId: 'thread', requestId: 'sync-nonblocking', response: { answers: {} } },
      owner: 'owner',
    },
  ]);
});

it('does not acknowledge a different local answer that raced the remote response', async () => {
  vi.useFakeTimers();
  const { ipc, client } = await fixture();

  ipc.handler = () => {
    ipc.state.requests = [];

    ipc.state.turns = [
      {
        turnId: 'turn',
        status: 'inProgress',
        items: [
          {
            id: 'receipt',
            type: 'userInputResponse',
            requestId: 'sync',
            turnId: 'turn',
            completed: true,
            answers: { q: ['Local answer'] },
          },
        ],
      },
    ];

    ipc.snapshot();

    return { ok: true };
  };

  const reply = Promise.resolve(client.respond('sync', { answers: { q: { answers: ['Blue'] } } }));
  const rejected = expect(reply).rejects.toThrow('UNKNOWN_AFTER_WRITE');

  await vi.advanceTimersByTimeAsync(10001);
  await rejected;
  expect(ipc.calls).toHaveLength(1);
});

it('does not reconstruct an async question answered by a native singleton wrapper', async () => {
  const { ipc, client } = await fixture();

  ipc.state.requests = [];
  const qid = JSON.stringify(['request_user_input_async', 'answered', 0]);

  const text =
    '<send_user_message_question_reply>\n' +
    JSON.stringify({ questionItemId: qid, question: 'Select direction', answer: 'Left' }) +
    '\n</send_user_message_question_reply>';

  ipc.state.turns = [
    {
      turnId: 'turn',
      status: 'inProgress',
      items: [
        {
          id: 'answered',
          type: 'agentMessage',
          delivery: 'async',
          questions: [{ title: 'Select direction', options: ['Left', 'Right'] }],
        },
        { id: 'reply', type: 'userMessage', content: [{ type: 'text', text }] },
      ],
    },
  ];

  ipc.snapshot();
  expect(client.pendingRequests()).toEqual([]);
});

it('captures native agentMessage questions when delivery metadata is absent', async () => {
  const { ipc, client } = await fixture();

  ipc.state.requests = [];

  ipc.state.turns = [
    {
      turnId: 'turn',
      status: 'inProgress',
      items: [{ id: 'plain-question', type: 'agentMessage', questions: [{ title: 'Choose', options: [] }] }],
    },
  ];

  ipc.snapshot();
  expect(client.pendingRequests()).toHaveLength(1);
});

it.each(['before', 'after'])(
  'confirms an exact native async receipt %s a lost IPC acknowledgement',
  async (order) => {
    vi.useFakeTimers();
    const { ipc, client } = await fixture();
    const qid = '["request_user_input_async","async-race",0]';

    const item = {
      id: 'async-race',
      type: 'agentMessage',
      questions: [{ title: 'Choose direction', options: ['Left', 'Right'] }],
    };

    ipc.state.requests = [];
    ipc.state.turns = [{ turnId: 'turn', status: 'inProgress', items: [item] }];
    ipc.snapshot();

    const accept = (params: Data) => {
      ipc.state.turns = [
        {
          turnId: 'turn',
          status: 'inProgress',
          items: [
            item,
            { id: 'accepted-reply', type: 'steeringUserMessage', status: 'accepted', input: params.input },
          ],
        },
      ];

      ipc.snapshot();
    };

    ipc.handler = (_method, params) => {
      if (order === 'before') {
        accept(params);
      } else {
        setTimeout(() => accept(params), 20);
      }

      throw new Error('UNKNOWN_AFTER_WRITE');
    };

    const reply = Promise.resolve(client.respond(qid, { answers: { [qid]: { answers: ['Right'] } } }));
    const confirmed = expect(reply).resolves.toBeUndefined();

    await vi.advanceTimersByTimeAsync(21);
    await confirmed;
    expect(client.pendingRequests()).toEqual([]);
  },
);

it('does not confirm an async receipt for a different answer to the same question', async () => {
  vi.useFakeTimers();
  const { ipc, client } = await fixture();
  const qid = '["request_user_input_async","async-race",0]';

  const item = {
    id: 'async-race',
    type: 'agentMessage',
    questions: [{ title: 'Choose direction', options: ['Left', 'Right'] }],
  };

  ipc.state.requests = [];
  ipc.state.turns = [{ turnId: 'turn', status: 'inProgress', items: [item] }];
  ipc.snapshot();

  ipc.handler = () => {
    const text =
      '<send_user_message_question_reply>\n' +
      JSON.stringify([{ questionItemId: qid, question: 'Choose direction', answer: 'Left' }]) +
      '\n</send_user_message_question_reply>';

    ipc.state.turns = [
      {
        turnId: 'turn',
        status: 'inProgress',
        items: [
          item,
          {
            id: 'local-reply',
            type: 'steeringUserMessage',
            status: 'accepted',
            input: [{ type: 'text', text }],
          },
        ],
      },
    ];

    ipc.snapshot();

    return { result: { turnId: 'turn' } };
  };

  const reply = Promise.resolve(client.respond(qid, { answers: { [qid]: { answers: ['Right'] } } }));
  const unknown = expect(reply).rejects.toThrow('UNKNOWN_AFTER_WRITE');

  await vi.advanceTimersByTimeAsync(10001);
  await unknown;
});
