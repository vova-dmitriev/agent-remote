import { SubagentStatus, type Session, type SubagentInfo } from '@protocol';
import { ClaudeHookEvent } from '../domain/claude.js';

const SUBAGENT_LIMIT = 50;

/** One child found in the session's `subagents` directory. */
export interface BackfilledSubagent {
  id: string;
  type?: string | undefined;
  description?: string | undefined;
  model?: string | undefined;
  finished: boolean;
  transcriptAvailable: boolean;
  updatedAt: number;
}

/** Insert or refresh one child entry, keeping the newest entries within the per-session limit. */
export function recordSubagent(
  agents: SubagentInfo[] = [],
  update: { id: string; name?: string | undefined; status?: SubagentInfo['status'] },
): SubagentInfo[] {
  const previous = agents.find((agent) => agent.id === update.id);

  return [
    ...agents.filter((agent) => agent.id !== update.id),
    {
      ...previous,
      id: update.id,
      ...(update.name ? { name: update.name, type: update.name } : {}),
      status: update.status ?? previous?.status ?? SubagentStatus.Running,
      updatedAt: Date.now(),
    },
  ].slice(-SUBAGENT_LIMIT);
}

/**
 * Merge children listed from transcript files into the hook-observed list, newest kept within the limit.
 * A finished file completes only a new or restored-unknown child; a live hook status stays authoritative.
 */
export function mergeBackfilledSubagents(
  agents: SubagentInfo[] = [],
  found: readonly BackfilledSubagent[],
): SubagentInfo[] {
  const merged = new Map(agents.map((agent) => [agent.id, agent]));

  for (const child of found) {
    const previous = merged.get(child.id);
    const completes = child.finished && (!previous || previous.status === SubagentStatus.Unknown);
    const name = previous?.name ?? child.type;
    const model = previous?.model ?? child.model;

    merged.set(child.id, {
      ...previous,
      id: child.id,
      ...(name ? { name } : {}),
      ...(child.type ? { type: child.type } : {}),
      ...(child.description ? { description: child.description } : {}),
      ...(model ? { model } : {}),
      transcriptAvailable: child.transcriptAvailable,
      status: completes ? SubagentStatus.Completed : (previous?.status ?? SubagentStatus.Unknown),
      updatedAt:
        previous && !completes ? previous.updatedAt : Math.max(previous?.updatedAt ?? 0, child.updatedAt),
    });
  }

  return [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-SUBAGENT_LIMIT);
}

/** Child status after one of its own hooks; `undefined` keeps the current status. */
export function subagentActivityStatus(event: string, previous?: SubagentInfo['status']) {
  if (event === ClaudeHookEvent.PreToolUse) {
    return SubagentStatus.Running;
  }

  if (event === ClaudeHookEvent.PermissionRequest) {
    return SubagentStatus.WaitingInput;
  }

  if (
    previous === SubagentStatus.WaitingInput &&
    [ClaudeHookEvent.PostToolUse, ClaudeHookEvent.PostToolUseFailure].some((candidate) => candidate === event)
  ) {
    return SubagentStatus.Running;
  }

  return previous;
}

/** Keep child metadata within the shared snapshot transport budget, favoring active recent work. */
export function boundSubagentSnapshots(sessions: Session[]): Session[] {
  let remaining = 32_768;
  const selected = new Map<string, SubagentInfo[]>();

  const children = sessions
    .flatMap((session) => (session.subagents ?? []).map((agent) => ({ sessionId: session.id, agent })))
    .sort(
      (a, b) =>
        Number(
          [SubagentStatus.Running, SubagentStatus.Queued, SubagentStatus.WaitingInput].some(
            (candidateValue) => candidateValue === b.agent.status,
          ),
        ) -
          Number(
            [SubagentStatus.Running, SubagentStatus.Queued, SubagentStatus.WaitingInput].some(
              (candidateValue) => candidateValue === a.agent.status,
            ),
          ) || b.agent.updatedAt - a.agent.updatedAt,
    );

  for (const { sessionId, agent } of children) {
    const bounded = {
      ...agent,
      ...(agent.task ? { task: agent.task.slice(0, 512) } : {}),
      ...(agent.description ? { description: agent.description.slice(0, 512) } : {}),
    };

    const bytes = Buffer.byteLength(JSON.stringify(bounded));

    if (bytes > remaining) {
      continue;
    }

    remaining -= bytes;
    const values = selected.get(sessionId) ?? [];

    values.push(bounded);
    selected.set(sessionId, values);
  }

  return sessions.map((session) =>
    session.subagents ? { ...session, subagents: selected.get(session.id) ?? [] } : session,
  );
}
