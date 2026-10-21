/** Where a rule applies: every session of a project (a git repository), or one session. */
export const RuleScopeKind = {
  Project: 'project',
  Session: 'session',
} as const;

export type RuleScopeKind = (typeof RuleScopeKind)[keyof typeof RuleScopeKind];

/** The rules Agent Remote ships, switched on with a toggle. */
export const ReadyRule = {
  Database: 'database',
  RemoveOutsideProject: 'rm_outside_project',
  ForcePush: 'force_push',
  DeployMigrations: 'deploy_migrations',
  Secrets: 'secrets',
} as const;

export type ReadyRule = (typeof ReadyRule)[keyof typeof ReadyRule];

export const RuleAction = {
  View: 'view',
  Toggle: 'toggle',
  Compile: 'compile',
  SaveOwn: 'save_own',
  Delete: 'delete',
  ForgetCommand: 'forget_command',
} as const;

export type RuleAction = (typeof RuleAction)[keyof typeof RuleAction];

/** How long a stopped command waits for the owner before it is denied. */
export const RULE_ANSWER_TIMEOUT_MS = 600_000;

export const MAX_RULE_PATTERNS = 20;
