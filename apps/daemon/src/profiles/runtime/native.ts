import {
  ErrorCode,
  AgentProvider,
  ProfileLimits,
  type ExecutionProfileSummary,
} from '../../../../../packages/protocol/src/index.js';
import { buildProfileEnvironment } from '../environment.js';
import { ProfileEnvironmentPurpose } from '../environment/values.js';
import { CodexProfileNative } from '../native/codex.js';
import { ProfileProcessCleanupError } from '../native/lifecycle/errors.js';
import type { ProfileRegistry } from '../registry.js';
import { RuntimeProfileCloseProofs } from './close-proofs.js';
import type { RuntimeProfilesOptions, RuntimeProfileHandle, RuntimeProfileVerification } from './types.js';

export class RuntimeProfileNative {
  private active = new Map<string, Set<RuntimeProfileHandle>>();
  private verifying = new Map<string, Set<RuntimeProfileVerification>>();
  private closeProofs: RuntimeProfileCloseProofs;

  constructor(
    private options: RuntimeProfilesOptions,
    private registry: ProfileRegistry,
    closeProofLimit: number = ProfileLimits.Operations,
  ) {
    this.closeProofs = new RuntimeProfileCloseProofs(closeProofLimit);
  }

  async verify(
    profile: ExecutionProfileSummary,
    current: () => boolean,
    secret?: string,
    operationId?: string,
  ) {
    if (this.active.get(profile.id)?.size || this.verifying.get(profile.id)?.size) {
      throw new Error(ErrorCode.PROFILE_EXECUTION_ACTIVE);
    }

    if (operationId) {
      this.closeProofs.reserve(operationId, profile.id, profile.version);
    }

    let finish!: () => void;
    const verification = { finished: new Promise<void>((resolve) => (finish = resolve)), finish };
    const verifying = this.verifying.get(profile.id) ?? new Set<RuntimeProfileVerification>();

    verifying.add(verification);
    this.verifying.set(profile.id, verifying);

    const assertCurrent = () => {
      if (!current()) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      if (this.registry.get(profile.id).version !== profile.version) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }
    };

    let handle: RuntimeProfileHandle | undefined;

    try {
      assertCurrent();

      if (profile.provider !== AgentProvider.Codex) {
        throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      const environment = await buildProfileEnvironment(this.registry, profile.id, {
        directory: this.options.directory,
        base: this.options.baseEnvironment,
        purpose: ProfileEnvironmentPurpose.Enrollment,
      });

      assertCurrent();

      handle = { opening: CodexProfileNative.open(environment, profile, this.options.native) };
      const handles = this.active.get(profile.id) ?? new Set<RuntimeProfileHandle>();

      handles.add(handle);
      this.active.set(profile.id, handles);

      const native = await handle.opening;

      assertCurrent();

      if (secret !== undefined) {
        await native.loginApiKey(secret);
        assertCurrent();
      }

      const evidence = await native.probe();

      assertCurrent();

      return evidence;
    } finally {
      let closed = false;

      try {
        if (handle) {
          await this.closeHandle(profile.id, handle);
        }

        if (operationId) {
          this.closeProofs.confirm(operationId, profile.id, profile.version);
        }

        closed = true;
      } finally {
        if (!closed && operationId) {
          this.closeProofs.forget(operationId);
        }

        const pending = this.verifying.get(profile.id);

        pending?.delete(verification);

        if (!pending?.size) {
          this.verifying.delete(profile.id);
        }

        verification.finish();
      }
    }
  }

  hasCloseProof(operationId: string, profileId: string, profileVersion: number): boolean {
    return this.closeProofs.has(operationId, profileId, profileVersion);
  }

  forgetCloseProof(operationId: string) {
    this.closeProofs.forget(operationId);
  }

  hasUnconfirmedHandle(id: string): boolean {
    return (this.active.get(id)?.size ?? 0) > 0;
  }

  async closeProfile(id: string): Promise<boolean> {
    const handles = this.active.get(id);
    const verifications = this.verifying.get(id);

    if (!handles?.size && !verifications?.size) {
      return false;
    }

    await Promise.all([
      ...[...(handles ?? [])].map((handle) => this.closeHandle(id, handle)),
      ...[...(verifications ?? [])].map((verification) => verification.finished),
    ]);

    return true;
  }

  private closeHandle(id: string, handle: RuntimeProfileHandle) {
    handle.closing ??= (async () => {
      const native = await handle.opening.catch((error: unknown) => {
        if (error instanceof ProfileProcessCleanupError) {
          throw error;
        }

        // A failed open returns only after its owned child has exited.
        return null;
      });

      await native?.close();
      const handles = this.active.get(id);

      handles?.delete(handle);

      if (!handles?.size) {
        this.active.delete(id);
      }
    })();

    return handle.closing;
  }

  async close() {
    const profiles = new Set([...this.active.keys(), ...this.verifying.keys()]);

    await Promise.all([...profiles].map((id) => this.closeProfile(id)));
  }
}
