import {
  BindingState,
  CommandActionType,
  CommandStatus,
  ErrorCode,
  IntegrationState,
  type CommandResult,
} from '@protocol';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { ormOn, type Database } from '../../db/database.js';
import { commandAudit, handoffOperations, sessions } from '../../db/schema/index.js';

export interface CommandAuditInput {
  ownerId: string;
  commandId: string;
  deviceId: string;
  sessionId: string;
  action: string;
  fingerprint: string;
  createdAt: number;
  status: CommandResult['status'];
  createSelection: unknown;
  createExpectedProfileVersion: number | null;
}

export interface CommandResultInput {
  ownerId: string;
  deviceId: string;
  commandId: string;
  status: string;
  code: string | null;
  sessionId: string | null;
}

const owned = (ownerId: string, commandId: string) =>
  and(eq(commandAudit.ownerId, ownerId), eq(commandAudit.commandId, commandId));

/** The command audit: what each owner's commands were and how they ended. */
export class CommandRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(operation: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(operation);
  }

  /** The public status of an owned command. */
  async status(ownerId: string, commandId: string) {
    const [row] = await this.db.orm
      .select({
        commandId: commandAudit.commandId,
        status: commandAudit.status,
        code: commandAudit.code,
        sessionId: commandAudit.resultSessionId,
      })
      .from(commandAudit)
      .where(owned(ownerId, commandId));

    return row;
  }

  async find(ownerId: string, commandId: string) {
    const [row] = await this.db.orm
      .select({
        fingerprint: commandAudit.fingerprint,
        status: sql<CommandResult['status']>`${commandAudit.status}`,
        code: commandAudit.code,
        result_session_id: commandAudit.resultSessionId,
      })
      .from(commandAudit)
      .where(owned(ownerId, commandId));

    return row;
  }

  /** The device of an owned handoff operation. */
  async handoffDevice(ownerId: string, operationId: string): Promise<string | undefined> {
    const [row] = await this.db.orm
      .select({ deviceId: handoffOperations.deviceId })
      .from(handoffOperations)
      .where(and(eq(handoffOperations.ownerId, ownerId), eq(handoffOperations.id, operationId)));

    return row?.deviceId;
  }

  /** Records a command once; returns whether this call recorded it. */
  async insert(tx: PoolClient, input: CommandAuditInput): Promise<boolean> {
    const rows = await ormOn(tx)
      .insert(commandAudit)
      .values({
        ownerId: input.ownerId,
        commandId: input.commandId,
        deviceId: input.deviceId,
        sessionId: input.sessionId,
        action: input.action,
        fingerprint: input.fingerprint,
        status: input.status,
        createdAt: input.createdAt,
        createSelection: input.createSelection,
        createExpectedProfileVersion: input.createExpectedProfileVersion,
      })
      .onConflictDoNothing()
      .returning({ commandId: commandAudit.commandId });

    return rows.length > 0;
  }

  async setOutcome(ownerId: string, commandId: string, status: string, code: string) {
    await this.db.orm.update(commandAudit).set({ status, code }).where(owned(ownerId, commandId));
  }

  /** Whether a device's verified, ready session was created by one of its create or restart commands. */
  async createdSession(
    ownerId: string,
    deviceId: string,
    sessionId: string,
    commandId: string,
  ): Promise<boolean> {
    const rows = await this.db.orm
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(
        commandAudit,
        and(eq(commandAudit.ownerId, sessions.ownerId), eq(commandAudit.deviceId, sessions.deviceId)),
      )
      .where(
        and(
          eq(sessions.ownerId, ownerId),
          eq(sessions.deviceId, deviceId),
          eq(sessions.id, sessionId),
          eq(commandAudit.commandId, commandId),
          inArray(commandAudit.action, [CommandActionType.CreateSession, CommandActionType.RestartSession]),
          sql`${sessions.data}->>'binding'=${BindingState.Verified}`,
          sql`${sessions.data}->>'integrationState'=${IntegrationState.Ready}`,
        ),
      );

    return rows.length > 0;
  }

  /** Records a device's result for one of its still accepted commands; returns whether it did. */
  async recordResult(input: CommandResultInput): Promise<boolean> {
    const rows = await this.db.orm
      .update(commandAudit)
      .set({ status: input.status, code: input.code, resultSessionId: input.sessionId })
      .where(
        and(
          eq(commandAudit.ownerId, input.ownerId),
          eq(commandAudit.deviceId, input.deviceId),
          eq(commandAudit.commandId, input.commandId),
          eq(commandAudit.status, CommandStatus.Accepted),
        ),
      )
      .returning({ commandId: commandAudit.commandId });

    return rows.length > 0;
  }

  /** Marks every owner's commands accepted before `before` and never acknowledged as unknown. */
  async expireUnacknowledged(before: number) {
    await this.db.orm
      .update(commandAudit)
      .set({ status: CommandStatus.Unknown, code: ErrorCode.ACK_TIMEOUT })
      .where(and(eq(commandAudit.status, CommandStatus.Accepted), lt(commandAudit.createdAt, before)));
  }

  /** Drops up to `limit` of every owner's commands created before `before`; returns how many. */
  async pruneBatch(before: number, limit: number): Promise<number> {
    const result = await this.db.orm.execute(
      sql`DELETE FROM ${commandAudit} WHERE ctid IN (SELECT ctid FROM ${commandAudit} WHERE ${commandAudit.createdAt}<${before} LIMIT ${limit})`,
    );

    return result.rowCount ?? 0;
  }
}
