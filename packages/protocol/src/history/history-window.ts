import { FrameType, MessageRole } from '../connection/values.js';
import { HistoryDirection } from './values.js';
import { subagentIdSchema } from '../session/subagents.js';
import { z } from 'zod';

export const HISTORY_PAGE_MESSAGES = 100;
export const HISTORY_CURSOR_MAX_LENGTH = 2048;
/** The newest owner's messages an outline keeps, and the characters of each one's text. */
export const HISTORY_OUTLINE_MESSAGES = 1000;
export const HISTORY_OUTLINE_TEXT_CHARS = 240;
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
  /** Reads that subagent's own transcript instead of the session's; only sent to `subagentHistory` sessions. */
  agentId: subagentIdSchema.optional(),
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

/** The outline of a conversation: its newest owner's messages (no tool lines), text shortened, attachments left out. */
export function outlineMessages<
  Message extends { role: string; text: string; tool?: unknown; attachments?: unknown },
>(messages: readonly Message[]): Omit<Message, 'attachments'>[] {
  return messages
    .filter((message) => message.role === MessageRole.User && !message.tool)
    .slice(-HISTORY_OUTLINE_MESSAGES)
    .map(({ attachments: _attachments, ...message }) => ({
      ...message,
      text: message.text.slice(0, HISTORY_OUTLINE_TEXT_CHARS),
    }));
}
