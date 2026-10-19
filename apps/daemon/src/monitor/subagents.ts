import { SubagentStatus, type Session, type SubagentInfo } from '@protocol';

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
    const bounded = { ...agent, ...(agent.task ? { task: agent.task.slice(0, 512) } : {}) };
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
