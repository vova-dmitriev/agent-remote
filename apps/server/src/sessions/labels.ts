import { ErrorCode, AgentProvider, type Session } from '@protocol';
import { z } from 'zod';
import { hash, type Principal } from '../auth/security.js';
import { Fault } from '../http/errors/fault.js';
import { type SessionRepository } from './repository.js';

const renameSchema = z.strictObject({
  title: z.string().trim().min(1).max(512),
  generation: z.string().min(1).max(512),
});

const sourceKey = (session: Session) =>
  hash(
    JSON.stringify([
      session.target.deviceId,
      session.target.kind.startsWith(AgentProvider.Codex) ? AgentProvider.Codex : AgentProvider.Claude,
      'threadId' in session.target
        ? session.target.threadId
        : (session.claudeSessionId ??
          ('chatBindingId' in session.target ? session.target.chatBindingId : session.id)),
    ]),
  );

export class SessionLabels {
  constructor(private repository: SessionRepository) {}
  async apply(principal: Principal, deviceId: string, sessions: Session[]): Promise<Session[]> {
    const labels = await this.repository.labels(principal.userId, deviceId);
    const activity = await this.repository.activity(principal.userId, deviceId);

    const names = new Map(labels.map((row) => [row.source_key, row.title]));
    const times = new Map(activity.map((row) => [row.session_id, Number(row.last_message_at)]));

    return sessions
      .map((session) => {
        const title = names.get(sourceKey(session));
        const lastMessageAt = session.lastMessageAt ?? times.get(session.id) ?? 0;

        return { ...session, ...(title ? { title } : {}), ...(lastMessageAt ? { lastMessageAt } : {}) };
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }
  /**
   * Renames an owned session of the current generation. When `native` says its device will rename it in the agent,
   * the relay's label is dropped so the agent's name (and later renames there) show; otherwise the label holds it.
   */
  async rename(
    principal: Principal,
    sessionId: string,
    input: unknown,
    native: (deviceId: string) => boolean = () => false,
  ) {
    const body = renameSchema.parse(input);

    return this.repository.transaction(async (tx) => {
      const row = await this.repository.lockLive(tx, principal.userId, sessionId);

      if (!row) {
        throw new Fault(ErrorCode.NOT_FOUND);
      }

      if (row.data.generation !== body.generation) {
        throw new Fault(ErrorCode.STALE_SESSION);
      }

      const inAgent = native(row.device_id);

      if (inAgent) {
        await this.repository.deleteLabel(tx, principal.userId, row.device_id, sourceKey(row.data));
      } else {
        await this.repository.saveLabel(tx, principal.userId, row.device_id, sourceKey(row.data), body.title);
      }

      await this.repository.setTitle(tx, principal.userId, row.device_id, sessionId, body.title);

      return { title: body.title, deviceId: row.device_id, inAgent };
    });
  }
}
