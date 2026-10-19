import { z } from 'zod';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentProvider, CodedError, ErrorCode, ProfileAuthMode } from '@protocol';
import { credentialReference } from '../credentials.js';
import { readClaudeApiKey } from './api-key-helper.js';
import { ClaudeProfileApi } from './values.js';

const modelsSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(256) })).max(ClaudeProfileApi.MaxModels),
});

async function responseBody(response: Response) {
  if (!response.ok || response.redirected) {
    await response.body?.cancel().catch(() => {});
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  }

  const reader = response.body?.getReader();

  if (!reader) {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > ClaudeProfileApi.MaxResponseBytes) {
        await reader.cancel();
        throw new CodedError(ErrorCode.UNAUTHORIZED);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  );

  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  } finally {
    bytes.fill(0);
  }
}

export async function verifyClaudeApiKey(
  configDirectory: string,
  credentialFile: string,
  apiFetch: typeof fetch = fetch,
) {
  if (!isAbsolute(configDirectory) || !isAbsolute(credentialFile)) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  const fromRoot = relative(resolve(configDirectory), resolve(credentialFile));

  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new CodedError(ErrorCode.UNAUTHORIZED);
  }

  const key = await readClaudeApiKey(credentialFile);

  const response = await apiFetch(ClaudeProfileApi.ModelsUrl, {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': ClaudeProfileApi.Version,
    },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(ClaudeProfileApi.TimeoutMs),
  }).catch(() => {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  });

  const parsed = modelsSchema.safeParse(await responseBody(response));

  if (!parsed.success) {
    throw new CodedError(ErrorCode.PROFILE_NOT_READY);
  }

  return {
    authMode: ProfileAuthMode.ApiKey,
    accountRef: credentialReference(AgentProvider.Claude, key),
    models: parsed.data.data.map((model) => model.id),
  };
}
