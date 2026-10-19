import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AgentProvider, CodedError, ErrorCode, ProfileAuthMode } from '@protocol';
import { ProfileCredentialLimits, ProfileRuntimeFile } from './environment/values.js';
import { ProfileIdentityPrefix, ProfileNativeLimits } from './native/values.js';

const credentialSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).max(ProfileNativeLimits.KeyBytes).nullish(),
  tokens: z.object({ account_id: z.string().min(1).max(512) }).nullish(),
});

async function withCodexCredentials<T>(
  directory: string,
  use: (credential: z.infer<typeof credentialSchema>) => Promise<T> | T,
): Promise<T> {
  const file = await open(
    join(directory, ProfileRuntimeFile.CodexCredentials),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  });

  const bytes = Buffer.alloc(ProfileCredentialLimits.MaxFileBytes + 1);

  try {
    const info = await file.stat();

    if (
      !info.isFile() ||
      info.mode & 0o077 ||
      info.size > ProfileCredentialLimits.MaxFileBytes ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);

    if (bytesRead > ProfileCredentialLimits.MaxFileBytes) {
      throw new CodedError(ErrorCode.UNAUTHORIZED);
    }

    let raw: unknown;

    try {
      raw = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    } catch {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    const parsed = credentialSchema.safeParse(raw);

    if (!parsed.success) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    const { OPENAI_API_KEY: key, tokens } = parsed.data;

    if (key && tokens) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    if (!key && !tokens) {
      throw new CodedError(ErrorCode.PROFILE_NOT_READY);
    }

    return await use(parsed.data);
  } finally {
    bytes.fill(0);
    await file.close();
  }
}

export function readCodexCredentialIdentity(directory: string) {
  return withCodexCredentials(directory, ({ OPENAI_API_KEY: key, tokens }) => {
    if (key) {
      return { authMode: ProfileAuthMode.ApiKey, accountRef: credentialReference(AgentProvider.Codex, key) };
    }

    return { authMode: ProfileAuthMode.Subscription, workspaceRef: tokens!.account_id };
  });
}

export function withCodexApiKey<T>(directory: string, use: (secret: string) => Promise<T>): Promise<T> {
  return withCodexCredentials(directory, ({ OPENAI_API_KEY: key }) => {
    if (!key) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    return use(key);
  });
}

export function credentialReference(provider: AgentProvider, secret: string) {
  const prefix =
    provider === AgentProvider.Codex ? ProfileIdentityPrefix.Key : ProfileIdentityPrefix.ClaudeKey;

  return prefix + createHash('sha256').update(secret).digest('hex');
}
