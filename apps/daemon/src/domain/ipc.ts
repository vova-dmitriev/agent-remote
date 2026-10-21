export const IpcMessageType = {
  Hook: 'hook',
  Wrapper: 'wrapper',
  DesktopBind: 'desktop_bind',
  CodexConnect: 'codex_connect',
  Response: 'response',
  Request: 'request',
  Registered: 'registered',
  CodexResult: 'codex_result',
  DesktopResult: 'desktop_result',
  HookResult: 'hook_result',
  /** The daemon holds a command for the owner's answer; the hook CLI waits longer for the result. */
  HookHold: 'hook_hold',
  ReleaseHookSocket: 'release_hook_socket',
  ReleaseResult: 'release_result',
} as const;

export type IpcMessageType = (typeof IpcMessageType)[keyof typeof IpcMessageType];

/** The agent whose hook `remote hook` relays; Claude when the hook does not say. */
export const HookAgent = {
  Claude: 'claude',
  Codex: 'codex',
} as const;

export type HookAgent = (typeof HookAgent)[keyof typeof HookAgent];

export const WrapperActionType = {
  Bind: 'bind',
  Prompt: 'prompt',
  Interrupt: 'interrupt',
  Snapshot: 'snapshot',
} as const;

export type WrapperActionType = (typeof WrapperActionType)[keyof typeof WrapperActionType];

/** Requests a daemon's own hook socket accepts. */
export const PrimaryHookMessageTypes = [
  IpcMessageType.Hook,
  IpcMessageType.Wrapper,
  IpcMessageType.DesktopBind,
  IpcMessageType.CodexConnect,
] as const;

/** The desktop companion's legacy listener receives Claude hooks and yields to the CLI daemon. */
export const LegacyHookMessageTypes = [IpcMessageType.Hook, IpcMessageType.ReleaseHookSocket] as const;

export const LegacyHookSocketState = {
  Disabled: 'disabled',
  Listening: 'listening',
  Occupied: 'occupied',
  Released: 'released',
  Refused: 'refused',
  KeyUnavailable: 'key_unavailable',
} as const;

export type LegacyHookSocketState = (typeof LegacyHookSocketState)[keyof typeof LegacyHookSocketState];
