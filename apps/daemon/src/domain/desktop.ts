export const DesktopMode = {
  Chat: 'chat',
  Code: 'code',
} as const;

export type DesktopMode = (typeof DesktopMode)[keyof typeof DesktopMode];

export const DesktopOperation = {
  Read: 'read',
  SendPrompt: 'send_prompt',
  Interrupt: 'interrupt',
  Bind: 'bind',
  Capabilities: 'capabilities',
  History: 'history',
} as const;

export type DesktopOperation = (typeof DesktopOperation)[keyof typeof DesktopOperation];
