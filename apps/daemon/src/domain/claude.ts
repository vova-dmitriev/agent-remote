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

export type ClaudeHookEvent = (typeof ClaudeHookEvent)[keyof typeof ClaudeHookEvent];

export const ClaudeRecordType = {
  User: 'user',
  Assistant: 'assistant',
  Attachment: 'attachment',
  CustomTitle: 'custom-title',
  AiTitle: 'ai-title',
} as const;

export type ClaudeRecordType = (typeof ClaudeRecordType)[keyof typeof ClaudeRecordType];

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
