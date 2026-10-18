export const CompanionStartup = {
  lockFile: 'companion-start.lock',
  timeoutMs: 10_000,
  pollMs: 25,
} as const;
export const CompanionArgument = { Browser: 'browser', StartLocal: 'start-local' } as const;
export type CompanionArgument = (typeof CompanionArgument)[keyof typeof CompanionArgument];
