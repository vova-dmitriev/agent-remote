import { ProfileAuthMode } from '../../../../../../packages/protocol/src/index.js';
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
