import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@protocol';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { claimRelayCommandId } from '../apps/server/src/continuity/command-claims.js';
import { ContinuityService } from '../apps/server/src/continuity/service.js';
import { Database } from '../apps/server/src/db/database.js';

const fixtures: { db: Database; admin: Pool; schema: string }[] = [];

async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

  const schema = `claim_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Database(url, schema);

  fixtures.push({ db, admin, schema });
  await db.migrate();

  const owner = randomUUID();
  const device = randomUUID();
  const generation = randomUUID();
  const conversationId = randomUUID();
  const sourceId = randomUUID();
  const sourceGeneration = randomUUID();

  await db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,1)', [owner, randomUUID()]);

  await db.pool.query(
    'INSERT INTO devices(id,owner_id,token_hash,generation,last_seen_at) VALUES($1,$2,$3,$4,1)',
    [device, owner, randomUUID(), generation],
  );

  const service = new ContinuityService(db, () => 10);
  const principal = { userId: owner, telegramId: 'test' };
  const scope = { deviceId: device, deviceGeneration: generation };

  await service.createConversation(principal, scope, {
    conversationId,
    id: sourceId,
    provider: 'codex',
    profileId: randomUUID(),
    mode: 'managed_cli',
    nativeSessionId: randomUUID(),
    generation: sourceGeneration,
  });

  const request = {
    ownerId: owner,
    deviceId: device,
    conversationId,
    expectedConversationVersion: 1,
    sourceExecutionId: sourceId,
    sourceGeneration,
    checkpointId: randomUUID(),
    checkpointDigest: 'a'.repeat(64),
    expectedProfileVersion: 1,
    selection: { provider: 'claude' as const, profileId: randomUUID(), model: 'claude-test' },
  };

  const start = (operationId: string) =>
    service.startHandoff(principal, scope, {
      operationId,
      request,
    });

  return { db, service, principal, scope, owner, device, conversationId, sourceId, start };
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ db, admin, schema }) => {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }),
  );
});

describe('handoff command ID claims', () => {
  it('rejects a command ID already present in audit and leaves the source active', async () => {
    const f = await setup();
    const commandId = randomUUID();

    await f.db.pool.query(
      'INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,1)',
      [f.owner, commandId, f.device, randomUUID(), 'prompt', 'prior', 'dispatched'],
    );

    await expect(f.start(commandId)).rejects.toMatchObject({ status: HttpStatus.Conflict });

    await expect(f.service.getConversation(f.principal, f.scope, f.conversationId)).resolves.toMatchObject({
      activeExecutionId: f.sourceId,
    });
  });

  it('serializes a normal command claim against a handoff reservation', async () => {
    const f = await setup();
    const commandId = randomUUID();

    const contenders = await Promise.allSettled([
      f.start(commandId),
      f.db.transaction((tx) => claimRelayCommandId(tx, f.owner, f.device, commandId, 'b'.repeat(64), 10)),
    ]);

    expect(contenders.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(contenders.filter((item) => item.status === 'rejected')).toHaveLength(1);

    await expect(f.service.getConversation(f.principal, f.scope, f.conversationId)).resolves.toMatchObject({
      activeExecutionId: f.sourceId,
    });
  });

  it('keeps either sequential claim ordering exclusive', async () => {
    const normalFirst = await setup();
    const firstId = randomUUID();

    await normalFirst.db.transaction((tx) =>
      claimRelayCommandId(tx, normalFirst.owner, normalFirst.device, firstId, 'f'.repeat(64), 10),
    );

    await expect(normalFirst.start(firstId)).rejects.toMatchObject({ status: HttpStatus.Conflict });

    const handoffFirst = await setup();
    const secondId = randomUUID();

    await handoffFirst.start(secondId);

    await expect(
      handoffFirst.db.transaction((tx) =>
        claimRelayCommandId(tx, handoffFirst.owner, handoffFirst.device, secondId, 'e'.repeat(64), 10),
      ),
    ).rejects.toMatchObject({ status: HttpStatus.Conflict });
  });

  it('rejects Ready passed through an unsafe phase cast before mutation', async () => {
    const f = await setup();
    const operation = await f.start(randomUUID());

    expect(() => f.service.setTerminal(f.principal, f.scope, operation.id, 1, 'ready' as never)).toThrow(
      'CONTINUITY_INVALID_PHASE',
    );

    const row = await f.db.pool.query('SELECT phase,operation_version FROM handoff_operations WHERE id=$1', [
      operation.id,
    ]);

    expect(row.rows[0]).toMatchObject({ phase: 'creating_target', operation_version: 1 });
  });
});
