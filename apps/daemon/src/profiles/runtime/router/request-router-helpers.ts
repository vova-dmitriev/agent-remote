import { ProfileOperationPhase } from '@protocol';
import { ProfileService } from '../../service.js';
import { ProfileAuthentication } from '../../authentication/service.js';
import { CredentialEnrollmentService } from '../../enrollment/service.js';
import { ProfileExecutionOwnership } from '../execution/execution-ownership.js';
import { RuntimeProfileQuotaService } from '../../quota/service.js';

export class RuntimeProfileRequestHelpers {
  constructor(
    protected service: ProfileService,
    protected authentication: ProfileAuthentication,
    protected enrollment: CredentialEnrollmentService,
    protected ownership: ProfileExecutionOwnership,
    protected quota: RuntimeProfileQuotaService,
  ) {}

  protected mutationCurrent(
    current: () => boolean,
    profileId: string,
    operationId: string,
    initialVersion: number,
  ) {
    return () => {
      if (!current() || !this.ownership.hasMutation(profileId, operationId)) {
        return false;
      }

      const expectedVersion = this.tryOperation(operationId)?.profileVersion ?? initialVersion;

      return this.service.registry.get(profileId).version === expectedVersion;
    };
  }

  protected releaseIfTerminal(
    mutation: ReturnType<ProfileExecutionOwnership['reserveMutation']> | undefined,
    operation: { phase: ProfileOperationPhase },
  ) {
    if (
      operation.phase === ProfileOperationPhase.Complete ||
      operation.phase === ProfileOperationPhase.Failed
    ) {
      mutation?.releaseTerminal();
    }
  }

  protected hasOperation(operationId: string) {
    return this.tryOperation(operationId) !== undefined;
  }

  private tryOperation(operationId: string) {
    try {
      return this.service.operation(operationId);
    } catch {
      return undefined;
    }
  }
}
