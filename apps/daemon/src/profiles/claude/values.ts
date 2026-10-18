export const ClaudeProfileArgument = {
  Bare: '--bare',
  SettingSources: '--setting-sources',
  Settings: '--settings',
} as const;

export const ClaudeProfileEnvironment = {
  ConfigDirectory: 'CLAUDE_CONFIG_DIR',
  ApiKeyFile: 'CLAUDE_PROFILE_API_KEY_FILE',
  OAuthToken: 'CLAUDE_CODE_OAUTH_TOKEN',
} as const;

export const ClaudeProfileCredential = {
  MaxBytes: 16384,
} as const;

export const ClaudeProfileApi = {
  ModelsUrl: 'https://api.anthropic.com/v1/models?limit=100',
  Version: '2023-06-01',
  MaxModels: 100,
  MaxResponseBytes: 256 * 1024,
  TimeoutMs: 5000,
} as const;

export const ClaudeProfileAuthMethod = {
  ApiKey: 'api_key',
  ApiKeyHelper: 'api_key_helper',
} as const;

export const ClaudeProfileNative = {
  ApiProvider: 'firstParty',
  ApiKeySource: 'apiKeyHelper',
} as const;

export const ClaudeProfileError = {
  AuthenticationEvidenceUnavailable: 'CLAUDE_AUTH_EVIDENCE_UNAVAILABLE',
  SubscriptionSignInNotWired: 'CLAUDE_SUBSCRIPTION_SIGN_IN_NOT_WIRED',
} as const;
