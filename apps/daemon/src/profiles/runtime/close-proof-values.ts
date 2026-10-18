export const RuntimeProfileCloseProofStatus = { Pending: 'pending', Closed: 'closed' } as const;
export type RuntimeProfileCloseProofStatus =
  (typeof RuntimeProfileCloseProofStatus)[keyof typeof RuntimeProfileCloseProofStatus];
