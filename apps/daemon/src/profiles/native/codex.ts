import { z } from 'zod';
import { verifyCodexApiCredential } from '../api/codex.js';
import {
  AgentProvider,
  CapabilitySupport,
  CodedError,
  ErrorCode,
  type ExecutionProfileSummary,
  ProfileAuthMode,
  profileAuthUrlSchema,
} from '@protocol';
import { CodexMethod } from '../../domain/codex/codex.js';
import type { CodexRpcClient } from '../../codex/rpc/rpc-client.js';
import type { ProfileVerification } from '../types.js';
import { openCodexProfileProcess } from './process.js';
import { nativeProfileIdentity } from './metadata.js';
import { nativeProfileModels } from './models.js';
import { CodexProfileAuthType, ProfileNativeLimits } from './values.js';
import type { ProfileNativeOptions } from './types.js';

const subscriptionSchema = z.object({
  type: z.literal(CodexProfileAuthType.Subscription),
  loginId: z.string().min(1).max(512),
  authUrl: profileAuthUrlSchema,
});

export class CodexProfileNative {
  private constructor(
    private client: CodexRpcClient,
    private directory: string,
    private profile: ExecutionProfileSummary,
    private options: ProfileNativeOptions,
  ) {}

  static async open(
    environment: NodeJS.ProcessEnv,
    profile: ExecutionProfileSummary,
    options: ProfileNativeOptions,
  ) {
    if (profile.provider !== AgentProvider.Codex || !environment.CODEX_HOME) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    const client = await openCodexProfileProcess(environment, profile.authMode, options);

    return new CodexProfileNative(client, environment.CODEX_HOME, profile, options);
  }

  async loginSubscription() {
    if (this.profile.authMode !== ProfileAuthMode.Subscription) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    const parsed = subscriptionSchema.safeParse(
      await this.client.request(CodexMethod.AccountLoginStart, { type: CodexProfileAuthType.Subscription }),
    );

    if (!parsed.success) {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    return { loginId: parsed.data.loginId, authUrl: parsed.data.authUrl };
  }

  async loginApiKey(apiKey: string) {
    if (this.profile.authMode !== ProfileAuthMode.ApiKey) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    const control = Array.from(apiKey).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );

    if (
      !apiKey ||
      Buffer.byteLength(apiKey) > ProfileNativeLimits.KeyBytes ||
      /\s/u.test(apiKey) ||
      control
    ) {
      throw new CodedError(ErrorCode.INVALID_REQUEST);
    }

    const response = await this.client.request(CodexMethod.AccountLoginStart, {
      type: CodexProfileAuthType.ApiKey,
      apiKey,
    });

    const parsed = z.object({ type: z.literal(CodexProfileAuthType.ApiKey) }).safeParse(response);

    if (!parsed.success) {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }
  }

  async probe(): Promise<ProfileVerification> {
    const identity = await nativeProfileIdentity(this.client, this.directory, this.profile.authMode, true);
    let models = await nativeProfileModels(this.client);

    if (this.profile.authMode === ProfileAuthMode.ApiKey) {
      const verified = await verifyCodexApiCredential(this.directory, this.options.apiFetch);

      if (verified.accountRef !== identity.accountRef) {
        throw new CodedError(ErrorCode.PROFILE_MISMATCH);
      }

      const available = new Set(verified.models);

      models = models.filter((model) => available.has(model.id));
    }

    const current = await nativeProfileIdentity(this.client, this.directory, this.profile.authMode, false);

    if (JSON.stringify(identity) !== JSON.stringify(current)) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    return {
      provider: AgentProvider.Codex,
      authMode: this.profile.authMode,
      identity: { ...identity, verifiedAt: Date.now() },
      capabilities: {
        isolation: CapabilitySupport.Supported,
        createSession: models.length > 0,
        contextSeed: true,
        resume: false,
        quota: false,
      },
      models,
    };
  }

  readRateLimits() {
    return this.client.request(CodexMethod.AccountRateLimitsRead, {});
  }

  close() {
    return this.client.close();
  }
}
