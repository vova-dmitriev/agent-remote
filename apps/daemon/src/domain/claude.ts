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
