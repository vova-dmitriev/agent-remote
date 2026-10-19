import { z } from 'zod';

export const executionIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const executionTimeSchema = z.number().int().nonnegative().safe();
export const executionVersionSchema = z.number().int().positive().safe();
export const checkpointDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
