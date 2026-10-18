import { immutableProfileScope } from '../storage/scope.js';
import type { ProfileAuthenticationOptions } from './types.js';

export function authenticationOptions(options: ProfileAuthenticationOptions): ProfileAuthenticationOptions {
  return {
    ...options,
    scope: immutableProfileScope(options.scope),
    baseEnvironment: { ...options.baseEnvironment },
    native: { ...options.native },
  };
}
