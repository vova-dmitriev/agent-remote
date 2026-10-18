import { ErrorCode } from '../../../../packages/protocol/src/index.js';
import { AgentProvider, type Session } from '../../../../packages/protocol/src/index.js';
import { z } from 'zod';
import { type Database } from '../db/database.js';
import { Fault, hash, type Principal } from '../auth/security.js';

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
  constructor(private db: Database) {}
  async apply(principal: Principal, deviceId: string, sessions: Session[]): Promise<Session[]> {
    const labels = await this.db.pool.query<{ source_key: string; title: string }>(
      'SELECT source_key,title FROM session_labels WHERE owner_id=$1 AND device_id=$2',
      [principal.userId, deviceId],
    );

    const activity = await this.db.pool.query<{ session_id: string; last_message_at: string }>(
      'SELECT session_id,last_message_at FROM session_activity WHERE owner_id=$1 AND device_id=$2',
      [principal.userId, deviceId],
    );

    const names = new Map(labels.rows.map((row) => [row.source_key, row.title]));
    const times = new Map(activity.rows.map((row) => [row.session_id, Number(row.last_message_at)]));

    return sessions
      .map((session) => {
        const title = names.get(sourceKey(session));
        const lastMessageAt = session.lastMessageAt ?? times.get(session.id) ?? 0;

        return { ...session, ...(title ? { title } : {}), ...(lastMessageAt ? { lastMessageAt } : {}) };
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }
  async rename(principal: Principal, sessionId: string, input: unknown) {
    const body = renameSchema.parse(input);

    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query<{ data: Session; device_id: string }>(
          'SELECT s.data,s.device_id FROM sessions s JOIN devices d ON d.owner_id=s.owner_id AND d.id=s.device_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL FOR UPDATE OF s',
          [principal.userId, sessionId],
        )
      ).rows[0];

      if (!row) {
        throw new Fault(ErrorCode.NOT_FOUND, 404);
      }

      if (row.data.generation !== body.generation) {
        throw new Fault(ErrorCode.STALE_SESSION, 409);
      }

      await tx.query(
        'INSERT INTO session_labels(owner_id,device_id,source_key,title) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,device_id,source_key) DO UPDATE SET title=EXCLUDED.title',
        [principal.userId, row.device_id, sourceKey(row.data), body.title],
      );

      await tx.query(
        "UPDATE sessions SET data=jsonb_set(data,'{title}',to_jsonb($4::text)) WHERE owner_id=$1 AND device_id=$2 AND id=$3",
        [principal.userId, row.device_id, sessionId, body.title],
      );

      return { title: body.title, deviceId: row.device_id };
    });
  }
}
