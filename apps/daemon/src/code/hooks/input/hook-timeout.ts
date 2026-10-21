import { RULE_ANSWER_TIMEOUT_MS } from '@protocol';
import { ClaudeAskUserQuestionTool, ClaudeHookEvent } from '../../../domain/claude.js';
import { HookAgent } from '../../../domain/ipc.js';
import { CLAUDE_QUESTION_TIMEOUT_MS } from './user-questions.js';

const RULE_HOLD_TIMEOUT_MS = RULE_ANSWER_TIMEOUT_MS + 30_000;
const CLAUDE_QUESTION_HOLD_TIMEOUT_MS = CLAUDE_QUESTION_TIMEOUT_MS + 30_000;

/** The CLI bridge must hold a Claude AskUserQuestion for its advertised broker lifetime. */
export function hookHoldTimeoutMs(payload: unknown, agent: HookAgent): number {
  if (
    agent === HookAgent.Claude &&
    payload !== null &&
    typeof payload === 'object' &&
    'hook_event_name' in payload &&
    payload.hook_event_name === ClaudeHookEvent.PreToolUse &&
    'tool_name' in payload &&
    payload.tool_name === ClaudeAskUserQuestionTool
  ) {
    return CLAUDE_QUESTION_HOLD_TIMEOUT_MS;
  }

  return RULE_HOLD_TIMEOUT_MS;
}
