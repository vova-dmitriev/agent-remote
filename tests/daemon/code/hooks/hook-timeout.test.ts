import { expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { setTimeout as realDelay } from 'node:timers/promises';
import { lineReader, writeFrame } from '@daemon/code/hooks/ipc.js';
import { deliverHook } from '@daemon/code/hooks/hook-delivery.js';
import { hookHoldTimeoutMs } from '@daemon/code/hooks/input/hook-timeout.js';
import { CLAUDE_QUESTION_TIMEOUT_MS } from '@daemon/code/hooks/input/user-questions.js';
import { ClaudeAskUserQuestionTool, ClaudeHookEvent } from '@daemon/domain/claude.js';
import { HookAgent } from '@daemon/domain/ipc.js';
import { RULE_ANSWER_TIMEOUT_MS } from '@protocol';

it('gives Claude AskUserQuestion its full hold budget while preserving the Codex rule budget', () => {
  const askQuestion = { hook_event_name: ClaudeHookEvent.PreToolUse, tool_name: ClaudeAskUserQuestionTool };

  expect(hookHoldTimeoutMs(askQuestion, HookAgent.Claude)).toBe(CLAUDE_QUESTION_TIMEOUT_MS + 30_000);
  expect(hookHoldTimeoutMs(askQuestion, HookAgent.Codex)).toBe(RULE_ANSWER_TIMEOUT_MS + 30_000);

  expect(
    hookHoldTimeoutMs({ hook_event_name: ClaudeHookEvent.PreToolUse, tool_name: 'Bash' }, HookAgent.Claude),
  ).toBe(RULE_ANSWER_TIMEOUT_MS + 30_000);
});

it('keeps a real held CLI hook pending beyond the old ten-minute rule budget', async () => {
  vi.useFakeTimers();
  const path = `/tmp/claude-question-hold-${process.pid}-${Date.now()}.sock`;
  let heldSocket: Socket | undefined;
  let resolveHeld!: (socket: Socket) => void;

  const held = new Promise<Socket>((resolve) => {
    resolveHeld = resolve;
  });

  const server = createServer((socket) => {
    lineReader(socket, () => {
      heldSocket = socket;
      writeFrame(socket, { type: 'hook_hold' });
      resolveHeld(socket);
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(path, resolve));
    let finished = false;
    const payload = { hook_event_name: ClaudeHookEvent.PreToolUse, tool_name: ClaudeAskUserQuestionTool };

    const result = deliverHook(
      [{ path, token: 'token' }],
      { type: 'hook', payload },
      1500,
      hookHoldTimeoutMs(payload, HookAgent.Claude),
    ).then((value) => {
      finished = true;

      return value;
    });

    await held;
    // Let the client consume hook_hold and replace its initial short timeout with holdMs.
    await realDelay(20);
    await vi.advanceTimersByTimeAsync(RULE_ANSWER_TIMEOUT_MS + 30_001);
    expect(finished).toBe(false);

    writeFrame(heldSocket!, {
      type: 'hook_result',
      output: { hookSpecificOutput: { decision: 'ask' } },
      settled: true,
    });

    await expect(result).resolves.toEqual({ hookSpecificOutput: { decision: 'ask' } });
  } finally {
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
