import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@protocol';
import { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { ContinuityService } from '@server/continuity/service.js';
import { Database } from '@server/db/database.js';
import { Fault } from '@server/http/errors/fault.js';

const fixtures: { db: Database; admin: Pool; schema: string }[] = [];

async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgres://claude_remote:local_test_only@127.0.0.1:55432/claude_remote_test';

  const schema = `continuity_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });

  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Database(url, schema);

  fixtures.push({ db, admin, schema });
  await db.migrate();
  const owner = randomUUID();
  const device = randomUUID();
  const generation = randomUUID();

  await db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,1)', [owner, randomUUID()]);

  await db.pool.query(
    'INSERT INTO devices(id,owner_id,token_hash,generation,last_seen_at) VALUES($1,$2,$3,$4,1)',
    [device, owner, randomUUID(), generation],
  );

  return { db, owner, device, generation, service: new ContinuityService(db, () => 10) };
}

const execution = (conversationId: string) => ({
  conversationId,
  id: randomUUID(),
  provider: 'codex' as const,
  profileId: randomUUID(),
  mode: 'managed_cli' as const,
  nativeSessionId: randomUUID(),
  generation: randomUUID(),
});

const scope = (deviceId: string, deviceGeneration: string) => ({ deviceId, deviceGeneration });
const principal = (userId: string) => ({ userId, telegramId: 'test' });

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ db, admin, schema }) => {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }),
  );
});

describe('owner-scoped continuity metadata', () => {
  it('hides foreign records and rejects every read after soft revocation', async () => {
    const f = await setup();
    const conversationId = randomUUID();

    await f.service.createConversation(
      principal(f.owner),
      scope(f.device, f.generation),
      execution(conversationId),
    );

    const otherOwner = randomUUID();
    const otherDevice = randomUUID();
    const otherGeneration = randomUUID();

    await f.db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,1)', [
      otherOwner,
      randomUUID(),
    ]);

    await f.db.pool.query(
      'INSERT INTO devices(id,owner_id,token_hash,generation,last_seen_at) VALUES($1,$2,$3,$4,1)',
      [otherDevice, otherOwner, randomUUID(), otherGeneration],
    );

    await expect(
      f.service.getConversation(principal(otherOwner), scope(otherDevice, otherGeneration), conversationId),
    ).rejects.toMatchObject({ status: HttpStatus.NotFound });

    await f.db.pool.query('UPDATE devices SET revoked_at=20 WHERE id=$1', [f.device]);

    await expect(
      f.service.getConversation(principal(f.owner), scope(f.device, f.generation), conversationId),
    ).rejects.toMatchObject({ status: HttpStatus.NotFound });
  });

  it('replays identical starts, rejects conflicting reuse, and keeps unknown source active', async () => {
    const f = await setup();
    const conversationId = randomUUID();
    const source = execution(conversationId);

    await f.service.createConversation(principal(f.owner), scope(f.device, f.generation), source);

    const request = {
      ownerId: f.owner,
      deviceId: f.device,
      conversationId,
      expectedConversationVersion: 1,
      sourceExecutionId: source.id,
      sourceGeneration: source.generation,
      checkpointId: randomUUID(),
      checkpointDigest: 'a'.repeat(64),
      expectedProfileVersion: 1,
      selection: { provider: 'claude' as const, profileId: randomUUID(), model: 'claude-test' },
    };

    const start = { operationId: randomUUID(), request };

    const first = await f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), start);

    expect(await f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), start)).toEqual(
      first,
    );

    await expect(
      f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), {
        ...start,
        request: { ...request, checkpointDigest: 'b'.repeat(64) },
      }),
    ).rejects.toMatchObject({ status: HttpStatus.Conflict });

    await expect(
      f.service.setTerminal(principal(f.owner), scope(f.device, f.generation), first.id, 1, 'unknown'),
    ).resolves.toMatchObject({ phase: 'unknown' });

    await expect(
      f.service.getConversation(principal(f.owner), scope(f.device, f.generation), conversationId),
    ).resolves.toMatchObject({ activeExecutionId: source.id });

    await expect(
      f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), {
        ...start,
        operationId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(Fault);
  });

  it('keeps the source active after a failed operation and permits a later operation', async () => {
    const f = await setup();
    const conversationId = randomUUID();
    const source = execution(conversationId);

    await f.service.createConversation(principal(f.owner), scope(f.device, f.generation), source);

    const request = {
      ownerId: f.owner,
      deviceId: f.device,
      conversationId,
      expectedConversationVersion: 1,
      sourceExecutionId: source.id,
      sourceGeneration: source.generation,
      checkpointId: randomUUID(),
      checkpointDigest: 'c'.repeat(64),
      expectedProfileVersion: 1,
      selection: { provider: 'claude' as const, profileId: randomUUID(), model: 'claude-test' },
    };

    const first = await f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), {
      operationId: randomUUID(),
      request,
    });

    await f.service.setTerminal(principal(f.owner), scope(f.device, f.generation), first.id, 1, 'failed');

    await expect(
      f.service.getConversation(principal(f.owner), scope(f.device, f.generation), conversationId),
    ).resolves.toMatchObject({ activeExecutionId: source.id });

    await expect(
      f.service.startHandoff(principal(f.owner), scope(f.device, f.generation), {
        operationId: randomUUID(),
        request: { ...request, expectedConversationVersion: 2 },
      }),
    ).resolves.toMatchObject({ phase: 'creating_target' });
  });
});
