import { AgentProvider, type ProfileAuthMode } from '@protocol';

export interface ClaudeProfileLaunchInput {
  provider: typeof AgentProvider.Claude;
  authMode: ProfileAuthMode;
  configDirectory: string;
  credentialFile?: string;
  helperPath?: string;
  nodeExecutable?: string;
}

export interface ClaudeProfileLaunch {
  args: string[];
  environment: NodeJS.ProcessEnv;
}

export interface ClaudeAuthenticationEvidence {
  authenticated: boolean;
  authMode: ProfileAuthMode;
  configDirectory: string;
  accountRef: string;
}

export interface VerifiedClaudeAuthentication {
  authMode: ProfileAuthMode;
  accountRef: string;
}
