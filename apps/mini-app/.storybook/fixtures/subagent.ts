import { ActivityKind, MessageRole, SessionStatus, SubagentStatus, ToolActivityPhase, type HistoryMessage, type Session } from "@protocol"
import { terminalSession } from "./session"

export const runningSubagentId = "synthetic-reviewer"
export const finishedSubagentId = "synthetic-tests"

export const subagentSession: Session = {
  ...terminalSession,
  status: SessionStatus.Running,
  capabilities: { ...terminalSession.capabilities, subagentHistory: true },
  subagents: [
    {
      id: runningSubagentId,
      name: "Reviewer",
      type: "code-reviewer",
      task: "Review the synthetic parser",
      model: "synthetic-model",
      status: SubagentStatus.Running,
      updatedAt: 1700000005000,
    },
    {
      id: finishedSubagentId,
      name: "Tests",
      task: "Run the synthetic test suite",
      status: SubagentStatus.Completed,
      updatedAt: 1700000004000,
    },
  ],
}

const at = (offset: number) => 1700000000000 + offset * 1000

/** A subagent transcript as the feed receives it after tool results are folded into their calls. */
export const subagentMessages: HistoryMessage[] = [
  { id: "prompt", role: MessageRole.User, text: "Review the synthetic parser for edge cases.", occurredAt: at(0) },
  { id: "plan", role: MessageRole.Assistant, text: "I'll read the parser and run its tests.", occurredAt: at(1) },
  {
    id: "read",
    role: MessageRole.Assistant,
    text: "/workspace/synthetic/src/parser.ts",
    occurredAt: at(2),
    tool: { id: "tool-read", phase: ToolActivityPhase.Completed, name: "Read", kind: ActivityKind.Read },
  },
  {
    id: "search",
    role: MessageRole.Assistant,
    text: "parseHeader",
    occurredAt: at(3),
    tool: { id: "tool-search", phase: ToolActivityPhase.Completed, name: "Grep", kind: ActivityKind.Search },
  },
  {
    id: "test",
    role: MessageRole.Assistant,
    text: "npm test -- parser",
    occurredAt: at(4),
    tool: { id: "tool-test", phase: ToolActivityPhase.Failed, name: "Bash", kind: ActivityKind.Command },
  },
  {
    id: "finding",
    role: MessageRole.Assistant,
    text: 'One **edge case** fails: an empty header.\n\n```typescript\nparseHeader("")\n```',
    occurredAt: at(5),
  },
  {
    id: "edit",
    role: MessageRole.Assistant,
    text: "/workspace/synthetic/src/parser.ts",
    occurredAt: at(6),
    tool: { id: "tool-edit", phase: ToolActivityPhase.Started, name: "Edit", kind: ActivityKind.Write },
  },
]
