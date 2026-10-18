import type { ProfileEnvironmentPurpose } from './values.js';

export interface ProfileEnvironmentOptions {
  directory: string;
  base: NodeJS.ProcessEnv;
  purpose?: ProfileEnvironmentPurpose;
}

export interface ProfileHomes {
  home: string;
  codex: string;
  claude: string;
  temporary: string;
  config: string;
  cache: string;
}
