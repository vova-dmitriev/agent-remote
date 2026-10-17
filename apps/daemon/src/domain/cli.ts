export const CliCommand = {
  Personal: 'personal',
  Pair: 'pair',
  Connect: 'connect',
  Start: 'start',
  Codex: 'codex',
  RestoreClaude: 'restore-claude',
  Claude: 'claude',
  Cmux: 'cmux',
  Hooks: 'hooks',
  Hook: 'hook',
  Desktop: 'desktop',
  Status: 'status',
} as const;

export type CliCommand = (typeof CliCommand)[keyof typeof CliCommand];

export const CliAction = {
  Bind: 'bind',
  Connect: 'connect',
  Install: 'install',
  Uninstall: 'uninstall',
} as const;
export type CliAction = (typeof CliAction)[keyof typeof CliAction];

export const LocalServiceStatus = { Ok: 'ok' } as const;
export type LocalServiceStatus = (typeof LocalServiceStatus)[keyof typeof LocalServiceStatus];

export const TelegramButtonType = { WebApp: 'web_app' } as const;
export type TelegramButtonType = (typeof TelegramButtonType)[keyof typeof TelegramButtonType];
