import { z } from 'zod';

export const readingPositionSchema = z.strictObject({
  messageId: z.string().min(1).max(512),
  offset: z.number().finite().gt(-1_000_000).lt(1_000_000),
  cursor: z.string().min(1).max(2048).optional(),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const readingPositionResponseSchema = z.strictObject({
  position: readingPositionSchema.nullable(),
});
export type ReadingPosition = z.infer<typeof readingPositionSchema>;
export type ReadingPositionResponse = z.infer<typeof readingPositionResponseSchema>;
