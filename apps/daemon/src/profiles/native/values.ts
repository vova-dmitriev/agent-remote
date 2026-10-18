import { CodexLaunchArgument } from '../../domain/codex.js';

export const CodexProfileAuthType = { Subscription: 'chatgpt', ApiKey: 'apiKey' } as const;
export const ProfileIdentityPrefix = {
  Account: 'codex-account:',
  Key: 'codex-key:',
  ClaudeKey: 'claude-key:',
} as const;
export const ProfileNativeLimits = {
  FrameBytes: 256 * 1024,
  Models: 100,
  Pages: 10,
  TimeoutMs: 15000,
  KeyBytes: 16384,
  CloseGraceMs: 1000,
  CloseKillWaitMs: 1000,
} as const;
export const CodexProfileArgument = {
  Config: '-c',
  FileAuth: 'cli_auth_credentials_store="file"',
  Provider: 'model_provider="openai"',
  Server: CodexLaunchArgument.Server,
  Subscription: 'forced_login_method="chatgpt"',
  ApiKey: 'forced_login_method="api"',
} as const;
export const ProfileProcessSignal = { Terminate: 'SIGTERM', Kill: 'SIGKILL' } as const;
