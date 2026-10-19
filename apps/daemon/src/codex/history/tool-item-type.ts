import { CodexItemType } from '../../domain/codex/codex.js';

export const CodexToolItemType = {
  CommandExecution: CodexItemType.CommandExecution,
  FileChange: CodexItemType.FileChange,
  WebSearch: CodexItemType.WebSearch,
  McpToolCall: CodexItemType.McpToolCall,
  DynamicToolCall: CodexItemType.DynamicToolCall,
  ImageView: CodexItemType.ImageView,
} as const;

export type CodexToolItemType = (typeof CodexToolItemType)[keyof typeof CodexToolItemType];

export const CODEX_TOOL_ITEM_TYPES: ReadonlySet<string> = new Set(Object.values(CodexToolItemType));
