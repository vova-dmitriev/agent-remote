import { expect, it } from 'vitest';
import { CodexSubagents } from '../apps/daemon/src/codex/subagents.js';
import { subagentSchema } from '../packages/protocol/src/subagents.js';

it('tracks actual child lifecycle without confusing completed spawn calls with completed children', () => {
  const tracker = new CodexSubagents();

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'spawn',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child'],
      prompt: 'Review parser',
      model: 'synthetic-model',
      agentsStates: { child: { status: 'running' } },
    },
    'turn',
    false,
  );

  expect(tracker.values()).toEqual([
    expect.objectContaining({
      id: 'child',
      task: 'Review parser',
      model: 'synthetic-model',
      status: 'running',
    }),
  ]);

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'wait',
      tool: 'wait',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'completed' } },
    },
    'turn',
    false,
  );

  expect(tracker.values()[0]).toMatchObject({
    task: 'Review parser',
    model: 'synthetic-model',
    status: 'completed',
  });

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'spawn',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } },
    },
    'turn',
    true,
  );

  expect(tracker.values()[0]?.status).toBe('completed');
});

it('does not replay old full snapshots over newer child state and preserves explicit errors', () => {
  const tracker = new CodexSubagents();

  const spawn = {
    type: 'collabAgentToolCall',
    id: 'spawn',
    receiverThreadIds: ['child'],
    agentsStates: { child: { status: 'pendingInit' } },
  };

  const wait = {
    type: 'collabAgentToolCall',
    id: 'wait',
    receiverThreadIds: ['child'],
    agentsStates: { child: { status: 'errored' } },
  };

  tracker.ingest(spawn, 'turn', false);
  tracker.ingest(wait, 'turn', false);
  tracker.ingest(spawn, 'turn', false);
  tracker.ingest(wait, 'turn', false);
  expect(tracker.values()[0]?.status).toBe('failed');
  expect(subagentSchema.safeParse({ ...tracker.values()[0], task: 'x'.repeat(4097) }).success).toBe(false);
});

it('tracks native subAgentActivity without manufacturing a completed status', () => {
  const tracker = new CodexSubagents();

  tracker.ingest(
    {
      type: 'subAgentActivity',
      id: 'start',
      kind: 'started',
      agentThreadId: 'child',
      agentPath: '/root/reviewer',
    },
    'turn',
    true,
  );

  expect(tracker.values()[0]).toMatchObject({ id: 'child', name: '/root/reviewer', status: 'running' });

  tracker.ingest(
    { type: 'subAgentActivity', id: 'stop', kind: 'interrupted', agentThreadId: 'child' },
    'turn',
    false,
  );

  expect(tracker.values()[0]?.status).toBe('stopped');
});

it('keeps newer child state when an older full-snapshot item changes and fills missing historical metadata', () => {
  const tracker = new CodexSubagents();

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'spawn',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } },
    },
    'turn',
    false,
  );

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'wait',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'completed' } },
    },
    'turn',
    false,
  );

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'spawn',
      status: 'completed',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } },
    },
    'turn',
    false,
  );

  expect(tracker.values()[0]?.status).toBe('completed');

  tracker.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'old-spawn',
      prompt: 'Original task',
      model: 'original-model',
      receiverThreadIds: ['child'],
      agentsStates: { child: { status: 'running' } },
    },
    'turn',
    true,
  );

  expect(tracker.values()[0]).toMatchObject({
    status: 'completed',
    task: 'Original task',
    model: 'original-model',
  });
});
