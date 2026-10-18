export const DesktopPrivateIpcChannel = { ProfileAuth: 'desktop:profile-auth' } as const;

export type DesktopPrivateIpcChannel =
  (typeof DesktopPrivateIpcChannel)[keyof typeof DesktopPrivateIpcChannel];
