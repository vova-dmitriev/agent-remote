export const ProfileAction = {
  EnrollApiKey: 'enroll_api_key',
  SignIn: 'sign_in_profile',
  Check: 'check_profile',
  Create: 'create_profile',
  Rename: 'rename_profile',
  Disable: 'disable_profile',
  Enable: 'enable_profile',
  SetDefault: 'set_default_profile',
  Remove: 'remove_profile',
} as const;
export type ProfileAction = (typeof ProfileAction)[keyof typeof ProfileAction];

export const ProfileOperationPhase = {
  Preparing: 'preparing',
  AwaitingAuthentication: 'awaiting_authentication',
  Removing: 'removing',
  Complete: 'complete',
  Failed: 'failed',
  Unknown: 'unknown',
} as const;
export type ProfileOperationPhase = (typeof ProfileOperationPhase)[keyof typeof ProfileOperationPhase];

export const ProfileLimits = {
  ActiveProfiles: 128,
  RetainedProfiles: 1024,
  Operations: 10000,
  PageBytes: 96 * 1024,
  ResponseBytes: 120 * 1024,
} as const;

export const ProfileRequestKind = {
  List: 'list',
  ListPage: 'list_page',
  Mutate: 'mutate',
  Operation: 'operation',
  Reconcile: 'reconcile',
  Recipient: 'recipient',
  BeginEnrollment: 'begin_enrollment',
  CompleteEnrollment: 'complete_enrollment',
  Authenticate: 'authenticate',
  Quota: 'read_quota',
} as const;
export type ProfileRequestKind = (typeof ProfileRequestKind)[keyof typeof ProfileRequestKind];
