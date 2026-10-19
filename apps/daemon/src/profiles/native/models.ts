import { z } from 'zod';
import { ErrorCode, ReasoningEffort, type ExecutionProfileSummary } from '@protocol';
import { CodexMethod } from '../../domain/codex.js';
import type { CodexRpcClient } from '../../codex/rpc-client.js';
import { ProfileNativeLimits } from './values.js';

const schema = z.object({
  data: z
    .array(
      z.object({
        model: z.string().min(1).max(512),
        hidden: z.boolean(),
        supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string().max(128) })).max(32),
      }),
    )
    .max(ProfileNativeLimits.Models),
  nextCursor: z.string().min(1).max(1024).nullish(),
});

export async function nativeProfileModels(
  client: CodexRpcClient,
): Promise<ExecutionProfileSummary['models']> {
  const models: ExecutionProfileSummary['models'] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < ProfileNativeLimits.Pages; page++) {
    const parsed = schema.safeParse(
      await client.request(CodexMethod.ModelList, {
        limit: ProfileNativeLimits.Models,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      }),
    );

    if (!parsed.success) {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    for (const entry of parsed.data.data) {
      if (!entry.hidden && !models.some((model) => model.id === entry.model)) {
        const efforts = entry.supportedReasoningEfforts.flatMap((value) => {
          const result = z.enum(ReasoningEffort).safeParse(value.reasoningEffort);

          return result.success ? [result.data] : [];
        });

        models.push({ id: entry.model, efforts: [...new Set(efforts)] });
      }
    }

    if (models.length > ProfileNativeLimits.Models) {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    cursor = parsed.data.nextCursor ?? undefined;

    if (!cursor) {
      return models;
    }

    if (cursors.has(cursor)) {
      throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    cursors.add(cursor);
  }

  throw new Error(ErrorCode.CODEX_PROTOCOL_ERROR);
}
