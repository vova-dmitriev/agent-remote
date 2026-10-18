export const HostKind = {
  Telegram: 'telegram',
  Desktop: 'desktop',
  Chrome: 'chrome',
} as const;

export type HostKind = (typeof HostKind)[keyof typeof HostKind];

export const ProviderFilterValue = { All: 'all', Claude: 'Claude', Codex: 'Codex' } as const;
export type ProviderFilterValue = (typeof ProviderFilterValue)[keyof typeof ProviderFilterValue];
