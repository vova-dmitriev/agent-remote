import { type AgentModel, ReasoningEffort } from '@protocol';

export const ClaudeHookEvent = {
  SessionStart: 'SessionStart',
  SessionEnd: 'SessionEnd',
  UserPromptSubmit: 'UserPromptSubmit',
  Stop: 'Stop',
  PermissionRequest: 'PermissionRequest',
  PreToolUse: 'PreToolUse',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: 'PostToolUseFailure',
  SubagentStart: 'SubagentStart',
  SubagentStop: 'SubagentStop',
  Notification: 'Notification',
} as const;

export const ClaudeNotificationType = { IdlePrompt: 'idle_prompt' } as const;
export const ClaudeAskUserQuestionTool = 'AskUserQuestion';
export const ClaudeHookDecision = { Allow: 'allow', Deny: 'deny' } as const;

export type ClaudeHookEvent = (typeof ClaudeHookEvent)[keyof typeof ClaudeHookEvent];

export const ClaudeRecordType = {
  User: 'user',
  Assistant: 'assistant',
  Attachment: 'attachment',
  CustomTitle: 'custom-title',
  AiTitle: 'ai-title',
} as const;

export type ClaudeRecordType = (typeof ClaudeRecordType)[keyof typeof ClaudeRecordType];

/** Claude Code's permission modes, as hooks report them in `permission_mode`. */
export const ClaudePermissionMode = { Bypass: 'bypassPermissions' } as const;

/** Claude's shell tool, the one whose input is a command line. */
export const ClaudeShellTool = 'Bash';

/** An attachment record Claude writes for a prompt typed while it was working. */
export const ClaudeAttachmentType = { QueuedCommand: 'queued_command' } as const;

/** Who queued a command: a person, or Claude Code itself (task notifications). */
export const ClaudeQueueOrigin = { Human: 'human' } as const;

export const ClaudeContentType = {
  Text: 'text',
  Image: 'image',
  Document: 'document',
  File: 'file',
  Pdf: 'pdf',
  Base64: 'base64',
  ToolUse: 'tool_use',
  ToolResult: 'tool_result',
} as const;

export type ClaudeContentType = (typeof ClaudeContentType)[keyof typeof ClaudeContentType];

export const ClaudeHookType = {
  Command: 'command',
} as const;

export type ClaudeHookType = (typeof ClaudeHookType)[keyof typeof ClaudeHookType];

export const ClaudeRestartArgument = {
  Continue: '--continue',
  ContinueShort: '-c',
  Fork: '--fork-session',
} as const;
export type ClaudeRestartArgument = (typeof ClaudeRestartArgument)[keyof typeof ClaudeRestartArgument];

/** Plan windows Claude Code caches in `.claude.json` (`cachedUsageUtilization.utilization`), with their length. */
export const ClaudeUsageWindowMinutes = {
  five_hour: 300,
  seven_day: 10_080,
} as const;

/** Claude Code's model aliases (`claude --model`): each names the latest model of its family. */
export const ClaudeModelAlias = {
  Fable: 'fable',
  Opus: 'opus',
  Sonnet: 'sonnet',
  Haiku: 'haiku',
} as const;

/** The models the app offers for Claude Code, with the levels `claude --effort` takes. */
export const CLAUDE_MODELS: AgentModel[] = Object.values(ClaudeModelAlias).map((id) => ({
  id,
  efforts: [
    ReasoningEffort.Low,
    ReasoningEffort.Medium,
    ReasoningEffort.High,
    ReasoningEffort.Xhigh,
    ReasoningEffort.Max,
  ],
}));

const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/u;
const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/u;
const COMMAND_OUTPUT = /^\s*<local-command-stdout>([\s\S]*)<\/local-command-stdout>\s*$/u;

/**
 * Claude Code records a slash command the owner ran (`/model sonnet`) and its output as tagged user text. Returns
 * the command as typed, or its output as Claude Code's answer; undefined for any other text.
 */
export function claudeCommandText(text: string): { text: string; output: boolean } | undefined {
  const output = COMMAND_OUTPUT.exec(text);

  if (output) {
    return { text: output[1]!.trim(), output: true };
  }

  const name = COMMAND_NAME.exec(text)?.[1]?.trim();

  if (!name) {
    return undefined;
  }

  const args = COMMAND_ARGS.exec(text)?.[1]?.trim();

  return { text: args ? `${name} ${args}` : name, output: false };
}
