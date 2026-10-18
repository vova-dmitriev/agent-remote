export const BrowserAction = {
  Install: 'install',
  Uninstall: 'uninstall',
  Host: 'host',
  StartLocal: 'start-local',
  Authorize: 'authorize',
  AuthorizeDesktop: 'authorize-desktop',
  Pending: 'pending',
  Revoke: 'revoke',
} as const;
export type BrowserAction = (typeof BrowserAction)[keyof typeof BrowserAction];
