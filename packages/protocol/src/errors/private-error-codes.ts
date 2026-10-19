export const SharedPrivateErrorCode = {
  HTTPS_REQUIRED: 'HTTPS_REQUIRED',
} as const;

export type SharedPrivateErrorCode = (typeof SharedPrivateErrorCode)[keyof typeof SharedPrivateErrorCode];
