import { z } from 'zod';
import { AgentProvider, CodedError, ErrorCode, HttpRequestMethod, HttpStatus } from '@protocol';
import { withCodexApiKey, readCodexCredentialIdentity, credentialReference } from '../credentials.js';
import { profileApiBody } from './body.js';
import { ProfileApiEndpoint, ProfileApiLimit, ProfileApiRequest } from './values.js';
import type { ProfileApiFetch } from './types.js';
import { logDebug } from '../../diagnostics/log.js';

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
      throw new CodedError(ErrorCode.NETWORK_UNAVAILABLE);
    }

    if (!response.ok) {
      await response.body?.cancel().catch((error: unknown) => logDebug('profiles/api/codex', error));

      if (response.status === HttpStatus.Unauthorized || response.status === HttpStatus.Forbidden) {
        throw new CodedError(ErrorCode.PROFILE_NOT_READY);
      }

      throw new CodedError(
        response.status === HttpStatus.TooManyRequests ? ErrorCode.RATE_LIMITED : ErrorCode.REQUEST_FAILED,
      );
    }

    let body: unknown;

    try {
      body = await profileApiBody(response);
    } catch {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    const catalog = catalogSchema.safeParse(body);

    if (!catalog.success) {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    const current = await readCodexCredentialIdentity(directory);

    if (current.accountRef !== accountRef) {
      throw new CodedError(ErrorCode.PROFILE_MISMATCH);
    }

    return { accountRef, models: [...new Set(catalog.data.data.map(({ id }) => id))] };
  });
}
