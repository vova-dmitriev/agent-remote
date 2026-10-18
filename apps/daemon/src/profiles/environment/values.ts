export const ProfileEnvironmentPurpose = {
  Enrollment: 'enrollment',
  Execution: 'execution',
} as const;
export type ProfileEnvironmentPurpose =
  (typeof ProfileEnvironmentPurpose)[keyof typeof ProfileEnvironmentPurpose];

export const PreservedProfileEnvironment = {
  Path: 'PATH',
  Term: 'TERM',
  ColorTerm: 'COLORTERM',
  Shell: 'SHELL',
  User: 'USER',
  Logname: 'LOGNAME',
  Lang: 'LANG',
  Locale: 'LC_ALL',
  CType: 'LC_CTYPE',
  TermProgram: 'TERM_PROGRAM',
  TermProgramVersion: 'TERM_PROGRAM_VERSION',
  CmuxWorkspace: 'CMUX_WORKSPACE_ID',
  CmuxSurface: 'CMUX_SURFACE_ID',
  CmuxSocket: 'CMUX_SOCKET_PATH',
  SshAgent: 'SSH_AUTH_SOCK',
} as const;

export const ProfileDirectoryName = {
  Profiles: 'profiles',
  Home: 'home',
  Codex: 'codex',
  Claude: 'claude',
  Temporary: 'tmp',
  Config: '.config',
  Cache: '.cache',
} as const;

export const ProfileRuntimeFile = { CodexConfig: 'config.toml', CodexCredentials: 'auth.json' } as const;
export const CodexProfileConfiguration = 'cli_auth_credentials_store = "file"\nmodel_provider = "openai"\n';
export const ProfileCredentialLimits = { MaxFileBytes: 1024 * 1024 } as const;
