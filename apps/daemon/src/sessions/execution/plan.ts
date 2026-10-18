import {
  ErrorCode,
  executionLaunchPlanSchema,
  executionLaunchSelectionSchema,
  knownErrorCode,
  type ExecutionLaunchSelection,
  type ExecutionProfileSummary,
} from '../../../../../packages/protocol/src/index.js';
import { buildProfileEnvironment } from '../../profiles/environment.js';
import { verifyProfileObservation } from '../../profiles/capabilities.js';
import type { ExecutionLaunchOptions, TrustedExecutionLaunch } from './types.js';

function validate(profile: ExecutionProfileSummary, selection: ExecutionLaunchSelection) {
  const parsed = executionLaunchPlanSchema.safeParse({ profile, selection });

  if (!parsed.success) {
    throw new Error(knownErrorCode(new Error(parsed.error.issues[0]?.message), ErrorCode.INVALID_REQUEST));
  }

  return parsed.data;
}

// This internal plan never crosses the transport boundary: it contains private runtime paths.
export async function prepareExecutionLaunch(
  input: ExecutionLaunchSelection,
  expectedVersion: number,
  options: ExecutionLaunchOptions,
  current = () => true,
): Promise<TrustedExecutionLaunch> {
  const requested = executionLaunchSelectionSchema.parse(input);

  const assertCurrent = () => {
    if (!current()) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    if (options.registry.get(requested.profileId).version !== expectedVersion) {
      throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
    }
  };

  assertCurrent();
  const { profile, selection } = validate(options.registry.get(requested.profileId), requested);
  const observed = verifyProfileObservation(profile, await options.verify(profile, current));

  assertCurrent();
  validate({ ...profile, ...observed }, selection);

  const environment = await buildProfileEnvironment(options.registry, profile.id, {
    directory: options.directory,
    base: options.baseEnvironment,
  });

  assertCurrent();

  return Object.freeze({ profile, selection, environment: Object.freeze(environment), assertCurrent });
}
