import { CodexSubagentActivityKind, CodexAgentStatus, CodexItemType } from '../../domain/codex/codex.js';
import { SubagentStatus, subagentSchema, type SubagentInfo } from '@protocol';
import { object } from '../events.js';

const states: Record<string, SubagentInfo['status']> = {
  [CodexAgentStatus.PendingInit]: SubagentStatus.Queued,
  [CodexAgentStatus.Running]: SubagentStatus.Running,
  [CodexAgentStatus.Interrupted]: SubagentStatus.Stopped,
  [CodexAgentStatus.Completed]: SubagentStatus.Completed,
  [CodexAgentStatus.Errored]: SubagentStatus.Failed,
  [CodexAgentStatus.Shutdown]: SubagentStatus.Stopped,
  [CodexAgentStatus.NotFound]: SubagentStatus.Unknown,
  [CodexAgentStatus.WaitingForInput]: SubagentStatus.WaitingInput,
};

export class CodexSubagents {
  private agents = new Map<string, SubagentInfo>();
  private seen = new Map<string, string>();
  private live = new Set<string>();
  private itemRanks = new Map<string, number>();
  private agentRanks = new Map<string, number>();
  private revision = 0;
  ingest(raw: unknown, turnId: string, historical: boolean): void {
    const item = object(raw);

    if (
      ![CodexItemType.CollabAgentToolCall, CodexItemType.SubAgentActivity].some(
        (candidateValue) => candidateValue === String(item.type),
      ) ||
      typeof item.id !== 'string'
    ) {
      return;
    }

    const key = JSON.stringify([turnId, item.id]),
      fingerprint = JSON.stringify(item);

    if (this.seen.get(key) === fingerprint) {
      return;
    }

    this.seen.set(key, fingerprint);

    if (this.seen.size > 1000) {
      this.seen.delete(this.seen.keys().next().value!);
    }

    const rank = this.itemRanks.get(key) ?? ++this.revision;

    this.itemRanks.set(key, rank);

    if (this.itemRanks.size > 1000) {
      this.itemRanks.delete(this.itemRanks.keys().next().value!);
    }

    const agents = object(item.agentsStates);

    const ids =
      item.type === CodexItemType.SubAgentActivity
        ? [item.agentThreadId]
        : [
            ...new Set([
              ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []),
              ...Object.keys(agents),
            ]),
          ];

    for (const id of ids) {
      if (typeof id !== 'string' || !id || id.length > 512) {
        continue;
      }

      const stale = (historical && this.live.has(id)) || rank < (this.agentRanks.get(id) ?? 0);

      if (!historical) {
        this.live.add(id);
      }

      if (!stale) {
        this.agentRanks.set(id, rank);
      }

      const previous = this.agents.get(id);
      const nativeState = object(agents[id]);

      const activityStatus =
        item.kind === CodexSubagentActivityKind.Interrupted ? SubagentStatus.Stopped : SubagentStatus.Running;

      const status =
        item.type === CodexItemType.SubAgentActivity
          ? activityStatus
          : (states[String(nativeState.status)] ?? previous?.status ?? SubagentStatus.Unknown);

      const bounded = (value: unknown, max: number) =>
        typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;

      const parsed = subagentSchema.safeParse({
        ...previous,
        id,
        status: stale && previous ? previous.status : status,
        updatedAt: stale && previous ? previous.updatedAt : Date.now(),
        ...(bounded(item.agentPath, 512)
          ? { name: stale ? (previous?.name ?? bounded(item.agentPath, 512)) : bounded(item.agentPath, 512) }
          : {}),
        ...(bounded(item.prompt, 4096)
          ? { task: stale ? (previous?.task ?? bounded(item.prompt, 4096)) : bounded(item.prompt, 4096) }
          : {}),
        ...(bounded(item.model, 256)
          ? { model: stale ? (previous?.model ?? bounded(item.model, 256)) : bounded(item.model, 256) }
          : {}),
      });

      if (!parsed.success) {
        continue;
      }

      this.agents.set(id, parsed.data);

      if (this.agents.size > 50) {
        const oldest = this.agents.keys().next().value!;

        this.agents.delete(oldest);
        this.live.delete(oldest);
        this.agentRanks.delete(oldest);
      }
    }
  }
  values(): SubagentInfo[] {
    return [...this.agents.values()];
  }
  has(id: string): boolean {
    return this.agents.has(id);
  }
}
