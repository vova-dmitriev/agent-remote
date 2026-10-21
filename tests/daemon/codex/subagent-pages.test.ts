import { expect, it } from 'vitest';
import { CodexSubagents } from '@daemon/codex/binding/subagents.js';
import { CodexSubagentPages } from '@daemon/codex/history/subagent-pages.js';
import { CodexMethod } from '@daemon/domain/codex/codex.js';
import { FrameType, HistoryDirection, type HistoryRead } from '@protocol';

const request = (agentId: string, direction: HistoryRead['direction'], anchor?: string): HistoryRead => ({
  type: FrameType.HistoryRead,
  requestId: 'request',
  sessionId: 'parent-session',
  generation: 'generation',
  direction,
  agentId,
  ...(anchor ? { anchor } : {}),
});

function knownChild() {
  const subagents = new CodexSubagents();

  subagents.ingest(
    {
      type: 'collabAgentToolCall',
      id: 'spawn',
      receiverThreadIds: ['known-child'],
    },
    'parent-turn',
    false,
  );

  return subagents;
}

it('reads a bounded Codex child page only for a currently listed child and keeps it out of parent history', async () => {
  const calls: unknown[] = [];

  const rpc = {
    request: async (method: string, params: unknown) => {
      calls.push([method, params]);

      return {
        data: [
          {
            turnId: 'child-turn',
            occurredAt: 20,
            item: { id: 'assistant', type: 'agentMessage', text: 'child answer' },
          },
          {
            turnId: 'child-turn',
            occurredAt: 10,
            item: {
              id: 'user',
              type: 'userMessage',
              content: [{ type: 'text', text: 'child task' }],
            },
          },
          { turnId: 'child-turn', item: { id: 'tool', type: 'commandExecution' } },
        ],
        nextCursor: 'opaque-next',
      };
    },
  } as never;

  const pages = new CodexSubagentPages('parent-session', 'generation', rpc, knownChild(), () => true);
  const result = await pages.page(request('known-child', HistoryDirection.Latest));

  expect(calls).toEqual([
    [CodexMethod.ThreadItemsList, { threadId: 'known-child', limit: 100, sortDirection: 'desc' }],
  ]);

  expect(result.messages.map(({ id, text }) => [id, text])).toEqual([
    ['child-turn:user', 'child task'],
    ['child-turn:assistant', 'child answer'],
  ]);

  expect(result.before).toBeTruthy();
  expect(result.after).toBeNull();
});

it('rejects a client supplied child id that is not in the bound parent listing', async () => {
  let calls = 0;

  const pages = new CodexSubagentPages(
    'parent-session',
    'generation',
    { request: async () => (calls++, {}) } as never,
    knownChild(),
    () => true,
  );

  await expect(pages.page(request('foreign-thread', HistoryDirection.Latest))).rejects.toThrow('NOT_FOUND');
  expect(calls).toBe(0);
});

it('rejects a pending response after the bound session or child is no longer current', async () => {
  let current = true;
  let release!: (value: unknown) => void;

  const pages = new CodexSubagentPages(
    'parent-session',
    'generation',
    { request: async () => new Promise((resolve) => (release = resolve)) } as never,
    knownChild(),
    () => current,
  );

  const pending = pages.page(request('known-child', HistoryDirection.Latest));

  current = false;
  release({ data: [], nextCursor: null });

  await expect(pending).rejects.toThrow('STALE_SESSION');
});

it('rejects malformed provider cursors instead of sending them to Codex', async () => {
  let calls = 0;

  const pages = new CodexSubagentPages(
    'parent-session',
    'generation',
    { request: async () => (calls++, {}) } as never,
    knownChild(),
    () => true,
  );

  await expect(pages.page(request('known-child', HistoryDirection.Before, 'tampered'))).rejects.toThrow(
    'INVALID_CURSOR',
  );

  expect(calls).toBe(0);
});

it('rejects an overlarge provider page instead of returning more than the protocol page bound', async () => {
  const pages = new CodexSubagentPages(
    'parent-session',
    'generation',
    { request: async () => ({}) } as never,
    knownChild(),
    () => true,
    async () => ({ data: Array.from({ length: 101 }, () => ({})), nextCursor: null }),
  );

  await expect(pages.page(request('known-child', HistoryDirection.Latest))).rejects.toThrow(
    'CODEX_PROTOCOL_ERROR',
  );
});
