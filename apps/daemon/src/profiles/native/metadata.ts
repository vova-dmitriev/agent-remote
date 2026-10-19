import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ErrorCode, ProfileAuthMode } from '@protocol';
import { CodexMethod } from '../../domain/codex.js';
import type { CodexRpcClient } from '../../codex/rpc-client.js';
import { readCodexCredentialIdentity } from '../credentials.js';
import { CodexProfileAuthType, ProfileIdentityPrefix } from './values.js';

const accountSchema = z.object({
  requiresOpenaiAuth: z.literal(true),
  account: z.discriminatedUnion('type', [
    z.object({ type: z.literal(CodexProfileAuthType.ApiKey) }),
    z.object({
      type: z.literal(CodexProfileAuthType.Subscription),
      email: z.string().trim().min(1).max(512),
      planType: z.string().max(128),
    }),
  ]),
});

export async function nativeProfileIdentity(
  client: CodexRpcClient,
  directory: string,
  mode: ProfileAuthMode,
  refreshToken: boolean,
) {
  const parsed = accountSchema.safeParse(await client.request(CodexMethod.AccountRead, { refreshToken }));

  if (!parsed.success) {
    throw new Error(ErrorCode.PROFILE_NOT_READY);
  }

  const account = parsed.data.account;

  const nativeMode =
    account.type === CodexProfileAuthType.ApiKey ? ProfileAuthMode.ApiKey : ProfileAuthMode.Subscription;

  const credential = await readCodexCredentialIdentity(directory);

  if (nativeMode !== mode || credential.authMode !== mode) {
    throw new Error(ErrorCode.PROFILE_MISMATCH);
  }

  if (account.type === CodexProfileAuthType.ApiKey && credential.accountRef) {
    return { accountRef: credential.accountRef };
  }

  if (account.type === CodexProfileAuthType.Subscription && credential.workspaceRef) {
    return {
      accountRef:
        ProfileIdentityPrefix.Account +
        createHash('sha256').update(account.email.toLowerCase()).digest('hex'),
      workspaceRef: credential.workspaceRef,
      accountLabel: account.email,
    };
  }

  throw new Error(ErrorCode.PROFILE_NOT_READY);
}
