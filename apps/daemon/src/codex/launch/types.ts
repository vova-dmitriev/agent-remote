export const ManagedCodexLaunchEvidenceType = {
  ExistingOrUnknown: 'existing_or_unknown',
  ChildCreated: 'child_created',
  NoChildCreated: 'no_child_created',
  ChildExited: 'child_exited',
} as const;
export type ManagedCodexLaunchEvidenceType =
  (typeof ManagedCodexLaunchEvidenceType)[keyof typeof ManagedCodexLaunchEvidenceType];

export const ManagedCodexChildState = {
  Exited: 'exited',
  Unverified: 'unverified',
  Unknown: 'unknown',
} as const;

export type ManagedCodexChildState = (typeof ManagedCodexChildState)[keyof typeof ManagedCodexChildState];

export type ManagedCodexLaunchEvidence =
  | { type: typeof ManagedCodexLaunchEvidenceType.ExistingOrUnknown }
  | { type: typeof ManagedCodexLaunchEvidenceType.ChildCreated; pid: number }
  | { type: typeof ManagedCodexLaunchEvidenceType.NoChildCreated }
  | { type: typeof ManagedCodexLaunchEvidenceType.ChildExited; pid: number };

export interface ManagedCodexLaunchOptions {
  environment: NodeJS.ProcessEnv;
  prefixArguments: readonly string[];
  onEvidence?: (evidence: ManagedCodexLaunchEvidence) => void;
}
