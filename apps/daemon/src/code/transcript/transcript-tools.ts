import { ToolActivityPhase, truncateUtf8, type ToolActivity } from '@protocol';
import { ClaudeContentType } from '../../domain/claude.js';
import { TOOL_ACTIVITY_KINDS } from '../../activity/tool-kinds.js';
import { ActivityKind } from '../../activity/activity-kind.js';
import {
  TRANSCRIPT_TOOL_DETAIL_BYTES,
  TRANSCRIPT_TOOL_RESULT_BYTES,
} from '../../domain/transcript/limits.js';

/** Input fields that say what a tool call is doing, in order of preference. */
const TOOL_DETAIL_KEYS = [
  'description',
  'command',
  'file_path',
  'path',
  'pattern',
  'url',
  'query',
  'prompt',
] as const;

export interface TranscriptToolItem {
  /** Position of the block inside the record; keeps item ids unique and stable per record. */
  index: number;
  text: string;
  tool: ToolActivity;
}

type Block = Record<string, unknown>;

const blocks = (content: unknown): Block[] =>
  Array.isArray(content)
    ? content.filter((block): block is Block => !!block && typeof block === 'object')
    : [];

const isToolBlock = (block: Block) =>
  (block.type === ClaudeContentType.ToolUse && typeof block.id === 'string' && !!block.id) ||
  (block.type === ClaudeContentType.ToolResult &&
    typeof block.tool_use_id === 'string' &&
    !!block.tool_use_id);

/** Number of tool items one transcript record yields. */
export function transcriptToolCount(content: unknown): number {
  return blocks(content).filter(isToolBlock).length;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  return blocks(content)
    .filter((block) => block.type === ClaudeContentType.Text && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

function useDetail(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') {
    return;
  }

  for (const key of TOOL_DETAIL_KEYS) {
    const value = (input as Record<string, unknown>)[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
}

/** Tool calls and results of one record as bounded activity items; text and media stay with the reader. */
export function transcriptToolItems(content: unknown): TranscriptToolItem[] {
  return blocks(content).flatMap((block, index): TranscriptToolItem[] => {
    if (!isToolBlock(block)) {
      return [];
    }

    if (block.type === ClaudeContentType.ToolUse) {
      const name = typeof block.name === 'string' && block.name ? block.name.slice(0, 256) : undefined;

      return [
        {
          index,
          text: truncateUtf8(useDetail(block.input) ?? name ?? '', TRANSCRIPT_TOOL_DETAIL_BYTES),
          tool: {
            id: String(block.id).slice(0, 512),
            phase: ToolActivityPhase.Started,
            ...(name ? { name } : {}),
            kind:
              name && Object.hasOwn(TOOL_ACTIVITY_KINDS, name)
                ? TOOL_ACTIVITY_KINDS[name]!
                : ActivityKind.Tool,
          },
        },
      ];
    }

    return [
      {
        index,
        text: truncateUtf8(resultText(block.content), TRANSCRIPT_TOOL_RESULT_BYTES),
        tool: {
          id: String(block.tool_use_id).slice(0, 512),
          phase: block.is_error === true ? ToolActivityPhase.Failed : ToolActivityPhase.Completed,
        },
      },
    ];
  });
}
