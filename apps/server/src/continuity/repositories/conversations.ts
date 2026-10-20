import type { PoolClient } from 'pg';
import { executionLinkSchema, type Conversation } from '@protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ormOn } from '../../db/database.js';
import { continuityConversations, devices, executionLinks } from '../../db/schema/index.js';
import { Fault } from '../../http/errors/fault.js';
import { ContinuityError, type InitialExecution } from '../types.js';
import { asConversation, asExecution } from './mapping.js';

export interface DeviceState {
  generation: string;
  snapshot: unknown;
}

const conversationOf = (ownerId: string, deviceId: string, id: string) =>
  and(
    eq(continuityConversations.ownerId, ownerId),
    eq(continuityConversations.deviceId, deviceId),
    eq(continuityConversations.id, id),
  );

const executionsOf = (ownerId: string, deviceId: string) =>
  and(eq(executionLinks.ownerId, ownerId), eq(executionLinks.deviceId, deviceId));

export class ConversationRepository {
  async device(tx: PoolClient, ownerId: string, deviceId: string, generation: string): Promise<DeviceState> {
    const [row] = await ormOn(tx)
      .select({ generation: devices.generation, revokedAt: devices.revokedAt, snapshot: devices.snapshot })
      .from(devices)
      .where(and(eq(devices.ownerId, ownerId), eq(devices.id, deviceId)))
      .for('update');

    if (!row || row.revokedAt !== null) {
      throw new Fault(ContinuityError.NotFound);
    }

    if (row.generation !== generation) {
      throw new Fault(ContinuityError.DeviceGenerationChanged);
    }

    return { generation: row.generation, snapshot: row.snapshot };
  }

  async conversation(tx: PoolClient, ownerId: string, deviceId: string, id: string, lock = false) {
    const conversation = await this.findConversation(tx, ownerId, deviceId, id, lock);

    if (!conversation) {
      throw new Fault(ContinuityError.NotFound);
    }

    return conversation;
  }

  async findConversation(tx: PoolClient, ownerId: string, deviceId: string, id: string, lock = false) {
    const query = ormOn(tx)
      .select()
      .from(continuityConversations)
      .where(conversationOf(ownerId, deviceId, id));

    const [row] = lock ? await query.for('update') : await query;

    return row ? asConversation(row) : null;
  }

  async execution(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string, id: string) {
    const [row] = await ormOn(tx)
      .select()
      .from(executionLinks)
      .where(
        and(
          executionsOf(ownerId, deviceId),
          eq(executionLinks.conversationId, conversationId),
          eq(executionLinks.id, id),
        ),
      );

    if (!row) {
      throw new Fault(ContinuityError.NotFound);
    }

    return asExecution(row);
  }

  async executions(tx: PoolClient, ownerId: string, deviceId: string, conversationId: string) {
    const rows = await ormOn(tx)
      .select()
      .from(executionLinks)
      .where(and(executionsOf(ownerId, deviceId), eq(executionLinks.conversationId, conversationId)))
      .orderBy(asc(executionLinks.createdAt), asc(executionLinks.id))
      .limit(100);

    return rows.map(asExecution);
  }

  async executionForSession(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    nativeSessionId: string,
    generation: string,
  ) {
    const [row] = await ormOn(tx)
      .select()
      .from(executionLinks)
      .where(
        and(
          executionsOf(ownerId, deviceId),
          eq(executionLinks.nativeSessionId, nativeSessionId),
          eq(executionLinks.generation, generation),
        ),
      )
      .limit(1);

    return row ? asExecution(row) : null;
  }

  async insertConversation(tx: PoolClient, value: Conversation) {
    await ormOn(tx).insert(continuityConversations).values({
      id: value.id,
      ownerId: value.ownerId,
      deviceId: value.deviceId,
      activeExecutionId: null,
      version: value.version,
      updatedAt: value.updatedAt,
    });
  }

  async insertExecution(
    tx: PoolClient,
    value: InitialExecution & { ownerId: string; deviceId: string },
    now: number,
  ) {
    const link = executionLinkSchema.parse({ ...value, createdAt: now });

    await ormOn(tx).insert(executionLinks).values(link);

    return link;
  }

  async setInitialExecution(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    conversationId: string,
    executionId: string,
  ) {
    await ormOn(tx)
      .update(continuityConversations)
      .set({ activeExecutionId: executionId })
      .where(conversationOf(ownerId, deviceId, conversationId));
  }

  async setActiveExecution(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    conversationId: string,
    executionId: string,
    expectedVersion: number,
    now: number,
  ) {
    return this.bump(tx, ownerId, deviceId, conversationId, expectedVersion, now, {
      activeExecutionId: executionId,
    });
  }

  async bumpConversation(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    expectedVersion: number,
    now: number,
  ) {
    return this.bump(tx, ownerId, deviceId, id, expectedVersion, now, {});
  }

  /** Advances a conversation at the expected version; a concurrent change is a conflict. */
  private async bump(
    tx: PoolClient,
    ownerId: string,
    deviceId: string,
    id: string,
    expectedVersion: number,
    now: number,
    change: { activeExecutionId?: string },
  ) {
    const [row] = await ormOn(tx)
      .update(continuityConversations)
      .set({ ...change, version: sql`${continuityConversations.version}+1`, updatedAt: now })
      .where(and(conversationOf(ownerId, deviceId, id), eq(continuityConversations.version, expectedVersion)))
      .returning();

    if (!row) {
      throw new Fault(ContinuityError.VersionConflict);
    }

    return asConversation(row);
  }
}
