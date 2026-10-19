import { CodedError, ErrorCode, ProfileAction, ProfileStatus } from '@protocol';
import { ProfileAuthentication } from '../../authentication/service.js';
import { CredentialEnrollmentService } from '../../enrollment/service.js';
import { ProfileService } from '../../service.js';
import { managedCodexChildState } from '../../../codex/launcher.js';
import { ProfileExecutionOwnership } from './execution-ownership.js';
import { ExecutionOwnershipTiming } from './execution-values.js';

export async function waitForProfileInactive(
  profileId: string,
  current: () => boolean,
  service: ProfileService,
  ownership: ProfileExecutionOwnership,
  authentication: ProfileAuthentication,
  enrollment: CredentialEnrollmentService,
) {
  while (ownership.isActive(profileId)) {
    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const profile = service.registry.get(profileId);

    if (profile.status !== ProfileStatus.Removing && profile.status !== ProfileStatus.Removed) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    for (const operationId of ownership.mutationOperations(profileId)) {
      const operation = service.operation(operationId);

      if (operation.action === ProfileAction.SignIn || operation.action === ProfileAction.Check) {
        await authentication.cancelForRemoval(operationId);
      } else if (operation.action === ProfileAction.EnrollApiKey) {
        await enrollment.cancelForRemoval(operationId);
      }
    }

    await ownership.reconcileExited(managedCodexChildState);

    if (ownership.isActive(profileId)) {
      await new Promise<void>((resolve) => setTimeout(resolve, ExecutionOwnershipTiming.RetryMs));
    }
  }
}
