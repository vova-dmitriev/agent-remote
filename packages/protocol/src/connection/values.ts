export const TargetKind = {
  Cmux: 'cmux',
  ClaudeCodeCli: 'claude-code-cli',
  ClaudeCodeDesktop: 'claude-code-desktop',
  ClaudeDesktopChat: 'claude-desktop-chat',
  CodexCli: 'codex-cli',
  CodexDesktop: 'codex-desktop',
} as const;

export type TargetKind = (typeof TargetKind)[keyof typeof TargetKind];

export const ConnectorTransport = {
  Cmux: 'cmux',
  Hooks: 'hooks',
  Pty: 'pty',
  Accessibility: 'accessibility',
  Channel: 'channel',
  AppServer: 'app-server',
} as const;

export type ConnectorTransport = (typeof ConnectorTransport)[keyof typeof ConnectorTransport];

export const FrameType = {
  Auth: 'auth',
  Subscribe: 'subscribe',
  Resume: 'resume',
  Command: 'command',
  HistoryRead: 'history_read',
  HistoryDone: 'history_done',
  HistoryItem: 'history_item',
  ProfilesRequest: 'profiles_request',
  ProfilesResult: 'profiles_result',
  ProfilesCancel: 'profiles_cancel',
  Heartbeat: 'heartbeat',
  Snapshot: 'snapshot',
  Event: 'event',
  CommandResult: 'command_result',
  HandoffSeedProof: 'handoff_seed_proof',
  HandoffSeedIntent: 'handoff_seed_intent',
  HandoffSeedAdmitted: 'handoff_seed_admitted',
  ContinuityRequest: 'continuity_request',
  ContinuityResult: 'continuity_result',
  Authenticated: 'authenticated',
  ResyncRequired: 'resync_required',
  DeviceStatus: 'device_status',
  Error: 'error',
  Select: 'select',
  SessionPin: 'session_pin',
  SessionRename: 'session_rename',
  Ack: 'ack',
} as const;

export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const EventType = {
  Message: 'message',
  Status: 'status',
  Tool: 'tool',
  Snapshot: 'snapshot',
  Permission: 'permission',
  BindingLost: 'binding_lost',
  UserInput: 'user_input',
  Activity: 'activity',
  SessionRenamed: 'session_renamed',
  TurnStart: 'turn_start',
  TurnEnd: 'turn_end',
  SessionEnd: 'session_end',
  Diagnostic: 'diagnostic',
  ToolStart: 'tool_start',
  ToolEnd: 'tool_end',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const MessageRole = {
  User: 'user',
  Assistant: 'assistant',
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** Reserved connector identities; other connector IDs remain opaque strings. */
export const ConnectorId = { Native: 'native' } as const;
export type ConnectorId = (typeof ConnectorId)[keyof typeof ConnectorId];

export const SocketCloseCode = {
  PolicyViolation: 1008,
  TryAgainLater: 1013,
  Offline: 4000,
  Unauthorized: 4001,
  Replaced: 4002,
  Revoked: 4003,
  ProtocolUnsupported: 4004,
} as const;
export type SocketCloseCode = (typeof SocketCloseCode)[keyof typeof SocketCloseCode];

export const SocketCloseReason = {
  Offline: 'OFFLINE',
  Unauthorized: 'UNAUTHORIZED',
  AuthTimeout: 'AUTH_TIMEOUT',
  TokenExpired: 'TOKEN_EXPIRED',
  Replaced: 'REPLACED',
  Revoked: 'REVOKED',
  InvalidFrame: 'INVALID_FRAME',
  ProtocolUnsupported: 'PROTOCOL_UNSUPPORTED',
} as const;
export type SocketCloseReason = (typeof SocketCloseReason)[keyof typeof SocketCloseReason];
