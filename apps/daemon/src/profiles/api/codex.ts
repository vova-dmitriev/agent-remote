import { z } from 'zod';
import { AgentProvider, ErrorCode, HttpRequestMethod } from '../../../../../packages/protocol/src/index.js';
import { withCodexApiKey, readCodexCredentialIdentity, credentialReference } from '../credentials.js';
import { profileApiBody } from './body.js';
import { ProfileApiEndpoint, ProfileApiLimit, ProfileApiRequest, ProfileApiStatus } from './values.js';
import type { ProfileApiFetch } from './types.js';

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(256) })).max(ProfileApiLimit.Models),
});

export async function verifyCodexApiCredential(directory: string, fetcher: ProfileApiFetch = fetch) {
  return withCodexApiKey(directory, async (secret) => {
    const accountRef = credentialReference(AgentProvider.Codex, secret);
    let response: Response;

    try {
      response = await fetcher(ProfileApiEndpoint.OpenAIModels, {
        method: HttpRequestMethod.Get,
        headers: { Authorization: `Bearer ${secret}` },
        redirect: ProfileApiRequest.Redirect,
        cache: ProfileApiRequest.Cache,
        credentials: ProfileApiRequest.Credentials,
        signal: AbortSignal.timeout(ProfileApiLimit.TimeoutMs),
      });
    } catch {
      throw new Error(ErrorCode.NETWORK_UNAVAILABLE);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});

      if (
        response.status === ProfileApiStatus.Unauthorized ||
        response.status === ProfileApiStatus.Forbidden
      ) {
        throw new Error(ErrorCode.PROFILE_NOT_READY);
      }

      throw new Error(
        response.status === ProfileApiStatus.RateLimited ? ErrorCode.RATE_LIMITED : ErrorCode.REQUEST_FAILED,
      );
    }

    let body: unknown;

    try {
      body = await profileApiBody(response);
    } catch {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    const catalog = catalogSchema.safeParse(body);

    if (!catalog.success) {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    const current = await readCodexCredentialIdentity(directory);

    if (current.accountRef !== accountRef) {
      throw new Error(ErrorCode.PROFILE_MISMATCH);
    }

    return { accountRef, models: [...new Set(catalog.data.data.map(({ id }) => id))] };
  });
}
