import {
  AgentProvider,
  ErrorCode,
  SessionListLimits,
  CodedError,
  sessionSchema,
  type Session,
} from '@protocol';
import { and, eq, sql } from 'drizzle-orm';
import { type Database, type Orm } from '../../db/database.js';
import { devices, sessionCatalog } from '../../db/schema/index.js';

function catalogValues(
  ownerId: string,
  deviceId: string,
  deviceGeneration: string,
  input: readonly Session[],
) {
  if (input.length > SessionListLimits.PageSize) {
    throw new CodedError(ErrorCode.INVALID_FRAME);
  }

  return input.map((value) => {
    const session = sessionSchema.parse(value);

    if (session.target.deviceId !== deviceId) {
      throw new CodedError(ErrorCode.NOT_FOUND);
    }

    const provider = session.target.kind.startsWith('codex-') ? AgentProvider.Codex : AgentProvider.Claude;

    const data = {
      ...session,
      currentActivity: undefined,
      changes: undefined,
      usage: undefined,
      subagents: undefined,
      nativeRestartState: undefined,
      capabilities: {
        ...session.capabilities,
        prompt: false,
        interrupt: false,
        permission: false,
        restartSession: false,
        createSession: false,
      },
    };

    return {
      ownerId,
      deviceId,
      deviceGeneration,
      id: session.id,
      provider: provider.toLowerCase(),
      recencyAt: session.lastMessageAt ?? session.createdAt ?? 0,
      data,
    };
  });
}

export async function saveSessionCatalog(
  orm: Orm,
  ownerId: string,
  deviceId: string,
  sessions: readonly Session[],
) {
  if (!sessions.length) {
    return;
  }

  const [device] = await orm
    .select({ generation: devices.generation })
    .from(devices)
    .where(and(eq(devices.ownerId, ownerId), eq(devices.id, deviceId)));

  if (!device) {
    throw new CodedError(ErrorCode.NOT_FOUND);
  }

  const values = catalogValues(ownerId, deviceId, device.generation, sessions);

  await orm
    .insert(sessionCatalog)
    .values(values)
    .onConflictDoUpdate({
      target: [sessionCatalog.ownerId, sessionCatalog.deviceId, sessionCatalog.id],
      set: {
        provider: sql`excluded.provider`,
        deviceGeneration: sql`excluded.device_generation`,
        recencyAt: sql`excluded.recency_at`,
        data: sql`excluded.data`,
      },
    });
}

/** The durable metadata catalog for pages older than a device's live snapshot. */
export class SessionCatalogRepository {
  constructor(private readonly db: Database) {}

  savePage(ownerId: string, deviceId: string, sessions: readonly Session[]) {
    return saveSessionCatalog(this.db.orm, ownerId, deviceId, sessions);
  }
}
