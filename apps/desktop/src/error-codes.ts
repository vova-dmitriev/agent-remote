export const DesktopErrorCode = {
  STALE_DESKTOP_RESULT: 'STALE_DESKTOP_RESULT',
} as const;

export type DesktopErrorCode = (typeof DesktopErrorCode)[keyof typeof DesktopErrorCode];
