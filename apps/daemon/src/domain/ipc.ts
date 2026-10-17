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
} as const;

export type IpcMessageType = (typeof IpcMessageType)[keyof typeof IpcMessageType];

export const WrapperActionType = {
  Bind: 'bind',
  Prompt: 'prompt',
  Interrupt: 'interrupt',
  Snapshot: 'snapshot',
} as const;

export type WrapperActionType = (typeof WrapperActionType)[keyof typeof WrapperActionType];
