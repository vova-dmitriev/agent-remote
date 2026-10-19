import { FrameType } from '../connection/values.js';
import { HistoryDirection } from './values.js';
import { z } from 'zod';

export const HISTORY_PAGE_MESSAGES = 100;
export const HISTORY_CURSOR_MAX_LENGTH = 2048;
export const HISTORY_DIRECTIONS = [
  HistoryDirection.Latest,
  HistoryDirection.Around,
  HistoryDirection.Before,
  HistoryDirection.After,
  HistoryDirection.Message,
] as const;
const id = z.string().min(1).max(512);

export const historyReadSchema = z.strictObject({
  type: z.literal(FrameType.HistoryRead),
  requestId: id,
  sessionId: id,
  generation: id,
  direction: z.enum(HistoryDirection),
  anchor: z.string().min(1).max(HISTORY_CURSOR_MAX_LENGTH).optional(),
});
export const historyDoneSchema = z.strictObject({
  type: z.literal(FrameType.HistoryDone),
  requestId: id,
  sessionId: id,
  generation: id,
  before: z.string().max(HISTORY_CURSOR_MAX_LENGTH).nullable(),
  after: z.string().max(HISTORY_CURSOR_MAX_LENGTH).nullable(),
  error: id.optional(),
});
export type HistoryRead = z.infer<typeof historyReadSchema>;
