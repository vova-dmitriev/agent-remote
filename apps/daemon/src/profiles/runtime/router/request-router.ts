import {
  ProfileAction,
  ProfileOperationPhase,
  ProfileRequestKind,
  type ProfileRequest,
  type ProfileResponse,
} from '@protocol';
import { profileListPage } from '../../lifecycle/page.js';
import { ProfileExecutionOwnership } from '../execution/execution-ownership.js';
import { RuntimeProfileRequestHelpers } from './request-router-helpers.js';

export class RuntimeProfileRequestRouter extends RuntimeProfileRequestHelpers {
  async route(request: ProfileRequest, current: () => boolean): Promise<ProfileResponse> {
    switch (request.kind) {
      case ProfileRequestKind.List:
        return { kind: request.kind, data: this.service.list() };
      case ProfileRequestKind.ListPage:
        return profileListPage(this.service.list(), request);
      case ProfileRequestKind.Mutate:
        return { kind: request.kind, data: await this.service.execute(request.mutation, current) };
      case ProfileRequestKind.Operation:
        return { kind: request.kind, data: this.service.operation(request.operationId) };
      case ProfileRequestKind.Quota:
        return {
          kind: request.kind,
          data: await this.quota.read(request.profileId, request.expectedVersion, current),
        };

      case ProfileRequestKind.Reconcile: {
        const operation = this.service.operation(request.operationId);
        let mutation: ReturnType<ProfileExecutionOwnership['reserveMutation']> | undefined;

        if (
          operation.action === ProfileAction.SignIn ||
          operation.action === ProfileAction.Check ||
          operation.action === ProfileAction.EnrollApiKey
        ) {
          mutation = this.ownership.reserveMutation(
            operation.profileId,
            operation.profileVersion,
            operation.id,
          );
        }

        let data;

        if (operation.action === ProfileAction.EnrollApiKey) {
          data = await this.enrollment.reconcile(
            operation.id,
            this.mutationCurrent(current, operation.profileId, operation.id, operation.profileVersion),
          );
        } else if (operation.action === ProfileAction.SignIn || operation.action === ProfileAction.Check) {
          data = await this.authentication.reconcile(
            operation.id,
            this.mutationCurrent(current, operation.profileId, operation.id, operation.profileVersion),
          );
        } else {
          data = await this.service.reconcile(operation.id, current);
        }

        this.releaseIfTerminal(mutation, data);

        if (data.phase === ProfileOperationPhase.Complete || data.phase === ProfileOperationPhase.Failed) {
          this.enrollment.forgetNativeCloseProof(data.id);
        }

        return { kind: request.kind, data };
      }

      case ProfileRequestKind.Recipient:
        return { kind: request.kind, data: await this.enrollment.recipient(current) };

      case ProfileRequestKind.BeginEnrollment: {
        const mutation = this.ownership.reserveMutation(
          request.input.profileId,
          request.input.expectedVersion,
          request.input.operationId,
        );

        try {
          const data = await this.enrollment.begin(
            request.input,
            this.mutationCurrent(
              current,
              request.input.profileId,
              request.input.operationId,
              request.input.expectedVersion,
            ),
          );

          this.releaseIfTerminal(mutation, this.enrollment.operation(request.input.operationId));

          return { kind: request.kind, data };
        } catch (error) {
          if (!this.hasOperation(request.input.operationId)) {
            mutation.releaseTerminal();
          }

          throw error;
        }
      }

      case ProfileRequestKind.CompleteEnrollment: {
        const operation = this.enrollment.operation(request.input.operationId);

        const mutation = this.ownership.reserveMutation(
          operation.profileId,
          operation.profileVersion,
          operation.id,
        );

        const data = await this.enrollment.complete(
          request.input,
          this.mutationCurrent(current, operation.profileId, operation.id, operation.profileVersion),
        );

        this.releaseIfTerminal(mutation, data);

        if (data.phase === ProfileOperationPhase.Complete || data.phase === ProfileOperationPhase.Failed) {
          this.enrollment.forgetNativeCloseProof(data.id);
        }

        return { kind: request.kind, data };
      }

      case ProfileRequestKind.Authenticate: {
        const mutation = this.ownership.reserveMutation(
          request.input.profileId,
          request.input.expectedVersion,
          request.input.operationId,
        );

        try {
          const result = await this.authentication.execute(
            request.input,
            this.mutationCurrent(
              current,
              request.input.profileId,
              request.input.operationId,
              request.input.expectedVersion,
            ),
          );

          this.releaseIfTerminal(mutation, result.operation);

          return {
            kind: request.kind,
            data: result.operation,
            ...(result.login ? { login: result.login } : {}),
          };
        } catch (error) {
          if (!this.hasOperation(request.input.operationId)) {
            mutation.releaseTerminal();
          }

          throw error;
        }
      }
    }
  }
}
