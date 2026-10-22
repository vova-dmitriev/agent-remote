import { FrameType, MessageRole } from '../connection/values.js';
import { HistoryDirection } from './values.js';
import { subagentIdSchema } from '../session/subagents.js';
import { z } from 'zod';

export const HISTORY_PAGE_MESSAGES = 100;
export const HISTORY_CURSOR_MAX_LENGTH = 2048;
/** The newest owner's messages an outline keeps, and the characters of each one's text. */
export const HISTORY_OUTLINE_MESSAGES = 1000;
export const HISTORY_OUTLINE_TEXT_CHARS = 240;
/** The newest matches a search keeps, the longest query, and how much text a match keeps before the words. */
export const HISTORY_SEARCH_MESSAGES = 200;
export const HISTORY_SEARCH_QUERY_CHARS = 200;
export const HISTORY_SEARCH_LEAD_CHARS = 60;
/** How many of a session's newest stored messages a search over the relay's or the Mac's cache reads. */
export const HISTORY_SEARCH_SCAN_MESSAGES = 5000;
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

/**
 * The messages (no tool lines) whose text holds the query, case-insensitively, newest kept; each text is cut to a
 * snippet that starts a little before the first match.
 */
export function searchMessages<
  Message extends { role: string; text: string; tool?: unknown; attachments?: unknown },
>(messages: readonly Message[], query: string): Omit<Message, 'attachments'>[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [];
  }

  return messages
    .flatMap(({ attachments: _attachments, ...message }) => {
      const at = message.tool ? -1 : message.text.toLowerCase().indexOf(needle);

      if (at < 0) {
        return [];
      }

      const start = Math.max(0, at - HISTORY_SEARCH_LEAD_CHARS);

      return [
        {
          ...message,
          text: (start ? '…' : '') + message.text.slice(start, start + HISTORY_OUTLINE_TEXT_CHARS),
        },
      ];
    })
    .slice(-HISTORY_SEARCH_MESSAGES);
}
