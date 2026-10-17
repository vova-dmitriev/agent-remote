export const Language = {
  Ru: 'ru',
  En: 'en',
} as const;

export type Language = (typeof Language)[keyof typeof Language];

export const ThemePreference = {
  Auto: 'auto',
  Light: 'light',
  Dark: 'dark',
} as const;

export type ThemePreference = (typeof ThemePreference)[keyof typeof ThemePreference];

export const ColorScheme = {
  Light: 'light',
  Dark: 'dark',
} as const;

export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];

export const ActivityKind = {
  Command: 'command',
  Read: 'read',
  Write: 'write',
  Search: 'search',
  Web: 'web',
  Tool: 'tool',
} as const;

export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

export const SubagentStatus = {
  Queued: 'queued',
  Running: 'running',
  WaitingInput: 'waiting_input',
  Completed: 'completed',
  Failed: 'failed',
  Stopped: 'stopped',
  Unknown: 'unknown',
} as const;

export type SubagentStatus = (typeof SubagentStatus)[keyof typeof SubagentStatus];
