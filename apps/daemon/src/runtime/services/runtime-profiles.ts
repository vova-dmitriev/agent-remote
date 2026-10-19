import {
  CodedError,
  ErrorCode,
  type ExecutionLaunchSelection,
  type ProfileRequest,
  ProfileRequestKind,
  profileRequestSchema,
  type ProfileResponse,
  profileResponseSchema,
} from '@protocol';
import { immutableProfileScope } from '../../profiles/storage/scope.js';
import { ProfileService } from '../../profiles/service.js';
import { ProfileAuthentication } from '../../profiles/authentication/service.js';
import { CredentialEnrollmentService } from '../../profiles/enrollment/service.js';
import { removeProfileCredentials } from '../../profiles/lifecycle/cleanup.js';
import { RuntimeProfileNative } from '../../profiles/runtime/native/native.js';
import type { RuntimeProfilesOptions } from '../../profiles/runtime/types.js';
import type { RuntimeProfilesPort } from '../../domain/ports/runtime-profiles.js';
import { prepareExecutionLaunch } from '../../sessions/execution/plan.js';
import { ProfileExecutionOwnership } from '../../profiles/runtime/execution/execution-ownership.js';
import { managedCodexChildState } from '../../codex/launcher.js';
import type { ProfiledExecutionLaunch } from '../../sessions/execution/types.js';
import { RuntimeProfileRequestRouter } from '../../profiles/runtime/router/request-router.js';
import { createRuntimeEnrollment } from '../../profiles/runtime/native/enrollment-adapter.js';
import { waitForProfileInactive } from '../../profiles/runtime/execution/wait-for-inactive.js';
import { RuntimeProfileQuotaService } from '../../profiles/quota/service.js';

export class RuntimeProfiles implements RuntimeProfilesPort {
  readonly scope;
  private service: ProfileService;
  private authentication: ProfileAuthentication;
  private enrollment: CredentialEnrollmentService;
  private native: RuntimeProfileNative;
  private ownership: ProfileExecutionOwnership;
  private closed = false;
  private router: RuntimeProfileRequestRouter;
  private quota: RuntimeProfileQuotaService;
  private pendingMutations = new Map<string, Promise<ProfileResponse>>();

  constructor(private options: RuntimeProfilesOptions) {
    this.scope = immutableProfileScope(options.scope);

    this.options = {
      ...options,
      scope: this.scope,
      baseEnvironment: { ...options.baseEnvironment },
      native: { ...options.native },
    };

    let ownership: ProfileExecutionOwnership | undefined;

    this.service = new ProfileService({
      ...this.options,
      executionActive: (profileId) => ownership?.isActive(profileId) ?? false,
      waitForInactive: (profileId, current) => this.waitForInactive(profileId, current),
      cleanup: async (profile, current) => {
        await this.authentication.closeProfile(profile.id);
        await this.native.closeProfile(profile.id);
        await removeProfileCredentials(this.options.directory, profile, current);
      },
    });

    this.ownership = ownership = new ProfileExecutionOwnership(
      this.options.database,
      this.scope,
      this.service.registry,
    );

    this.native = new RuntimeProfileNative(this.options, this.service.registry);
    this.quota = new RuntimeProfileQuotaService(this.service.registry, this.native, this.ownership);
    this.authentication = new ProfileAuthentication({ ...this.options, registry: this.service.registry });

    this.enrollment = createRuntimeEnrollment(this.options, this.service.registry, this.native);

    this.router = new RuntimeProfileRequestRouter(
      this.service,
      this.authentication,
      this.enrollment,
      this.ownership,
      this.quota,
    );
  }

  async request(input: ProfileRequest, current = () => true): Promise<ProfileResponse> {
    const authorized = () => !this.closed && current();

    if (!authorized()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const request = profileRequestSchema.parse(input);

    if (request.kind === ProfileRequestKind.Mutate) {
      return this.mutate(request, authorized);
    }

    if (request.kind === ProfileRequestKind.Reconcile) {
      await this.pendingMutations.get(request.operationId)?.catch(() => undefined);
    }

    return this.executeRequest(request, authorized);
  }

  private async waitForInactive(profileId: string, current: () => boolean) {
    await waitForProfileInactive(
      profileId,
      current,
      this.service,
      this.ownership,
      this.authentication,
      this.enrollment,
    );
  }

  private async mutate(request: ProfileRequest, authorized: () => boolean): Promise<ProfileResponse> {
    if (request.kind !== ProfileRequestKind.Mutate) {
      throw new CodedError(ErrorCode.INVALID_REQUEST);
    }

    const operationId = request.mutation.operationId;
    let pending: Promise<ProfileResponse> | undefined;

    while ((pending = this.pendingMutations.get(operationId))) {
      await pending.catch(() => undefined);
    }

    const execution = this.executeRequest(request, authorized);

    this.pendingMutations.set(operationId, execution);

    try {
      return await execution;
    } finally {
      if (this.pendingMutations.get(operationId) === execution) {
        this.pendingMutations.delete(operationId);
      }
    }
  }

  private async executeRequest(request: ProfileRequest, authorized: () => boolean): Promise<ProfileResponse> {
    if (!authorized()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    await this.ownership.reconcileExited(managedCodexChildState);

    if (
      !this.options.inputEnabled &&
      request.kind !== ProfileRequestKind.List &&
      request.kind !== ProfileRequestKind.ListPage &&
      request.kind !== ProfileRequestKind.Operation &&
      request.kind !== ProfileRequestKind.Quota
    ) {
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    const result = await this.router.route(request, authorized);

    if (!authorized()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    return profileResponseSchema.parse(result);
  }

  prepareExecution(
    selection: ExecutionLaunchSelection,
    expectedVersion: number,
    current = () => true,
  ): Promise<ProfiledExecutionLaunch> {
    if (!this.options.inputEnabled) {
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
    }

    if (!current()) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const lease = this.ownership.reserve(selection.profileId, expectedVersion);

    return prepareExecutionLaunch(
      selection,
      expectedVersion,
      {
        registry: this.service.registry,
        directory: this.options.directory,
        baseEnvironment: this.options.baseEnvironment,
        verify: (profile, authorized) => this.native.verify(profile, authorized),
      },
      () => !this.closed && current(),
    )
      .then((launch) => Object.freeze({ ...launch, executionLease: lease }))
      .catch((error: unknown) => {
        if (!this.native.hasUnconfirmedHandle(selection.profileId)) {
          lease.releaseBeforeLaunch();
        }

        throw error;
      });
  }

  async close() {
    this.closed = true;
    await this.authentication.close();
    await this.native.close();
  }
}
