export const ContinuityLocalRequestKind = {
  InspectSource: 'inspect_source',
  PrepareCheckpoint: 'prepare_checkpoint',
  ApproveCheckpoint: 'approve_checkpoint',
} as const;
export type ContinuityLocalRequestKind =
  (typeof ContinuityLocalRequestKind)[keyof typeof ContinuityLocalRequestKind];

export const ContinuityCompatibilityReason = {
  UnsupportedProvider: 'unsupported_provider',
  UnknownProfile: 'unknown_profile',
  ProfileUnavailable: 'profile_unavailable',
  SessionUnverified: 'session_unverified',
  SessionBusy: 'session_busy',
  HistoryUnavailable: 'history_unavailable',
} as const;
export type ContinuityCompatibilityReason =
  (typeof ContinuityCompatibilityReason)[keyof typeof ContinuityCompatibilityReason];
