import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentProvider, ErrorCode, ProfileAuthMode } from '../../../../../packages/protocol/src/index.js';
import { ClaudeProfileArgument, ClaudeProfileEnvironment } from './values.js';
import type { ClaudeProfileLaunch, ClaudeProfileLaunchInput } from './types.js';

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function credentialHelper(input: ClaudeProfileLaunchInput) {
  if (!input.credentialFile || !input.helperPath || !input.nodeExecutable) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  if (![input.credentialFile, input.helperPath, input.nodeExecutable].every(isAbsolute)) {
    throw new Error(ErrorCode.INVALID_REQUEST);
  }

  const configRoot = resolve(input.configDirectory);
  const credentialPath = resolve(input.credentialFile);
  const fromRoot = relative(configRoot, credentialPath);

  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(ErrorCode.UNAUTHORIZED);
  }

  return `${shellQuote(input.nodeExecutable)} ${shellQuote(input.helperPath)}`;
}

function isolatedEnvironment(base: NodeJS.ProcessEnv, configDirectory: string) {
  const environment = { ...base };

  for (const key of Object.keys(environment)) {
    if (
      key.startsWith('ANTHROPIC_') ||
      key.startsWith('CLAUDE_CODE_USE_') ||
      key === ClaudeProfileEnvironment.OAuthToken ||
      key.startsWith('AWS_') ||
      key.startsWith('GOOGLE_')
    ) {
      delete environment[key];
    }
  }

  delete environment[ClaudeProfileEnvironment.ApiKeyFile];
  environment[ClaudeProfileEnvironment.ConfigDirectory] = resolve(configDirectory);

  return environment;
}

export function buildClaudeProfileLaunch(
  input: ClaudeProfileLaunchInput,
  base: NodeJS.ProcessEnv = process.env,
): ClaudeProfileLaunch {
  if (input.provider !== AgentProvider.Claude || !isAbsolute(input.configDirectory)) {
    throw new Error(ErrorCode.PROFILE_MISMATCH);
  }

  const args = [ClaudeProfileArgument.SettingSources, ''];
  const environment = isolatedEnvironment(base, input.configDirectory);

  if (input.authMode === ProfileAuthMode.Subscription) {
    return { args, environment };
  }

  if (input.authMode !== ProfileAuthMode.ApiKey) {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  const apiKeyHelper = credentialHelper(input);
  const settings = JSON.stringify({ apiKeyHelper });

  args.unshift(ClaudeProfileArgument.Bare);
  args.push(ClaudeProfileArgument.Settings, settings);
  environment[ClaudeProfileEnvironment.ApiKeyFile] = resolve(input.credentialFile!);

  return { args, environment };
}
