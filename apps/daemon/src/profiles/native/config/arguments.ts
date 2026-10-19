import { ProfileAuthMode } from '@protocol';
import { CodexProfileArgument } from '../values.js';

export function profileNativeArguments(mode: ProfileAuthMode) {
  return [
    CodexProfileArgument.Config,
    CodexProfileArgument.FileAuth,
    CodexProfileArgument.Config,
    CodexProfileArgument.Provider,
    CodexProfileArgument.Config,
    mode === ProfileAuthMode.Subscription ? CodexProfileArgument.Subscription : CodexProfileArgument.ApiKey,
  ];
}
