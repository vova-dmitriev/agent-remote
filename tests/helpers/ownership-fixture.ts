import { randomUUID } from 'node:crypto';
import { ContinuityService } from '@server/continuity/service.js';
import { databaseFixture } from './database.js';

/** PostgreSQL SQLSTATE codes the ownership tests expect. */
export const PgErrorCode = { ForeignKeyViolation: '23503' } as const;

/**
 * Owner A with a live device, a session and one row in every owner-scoped table; owner B with nothing.
 * Repository ownership tests call each method as B with A's ids and expect nothing back and nothing changed.
 */
export async function ownershipFixture() {
  const database = await databaseFixture();
  const { db } = database;

  const ids = {
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    deviceA: randomUUID(),
    generation: randomUUID(),
    sessionA: 'session-a',
    streamA: 'stream-a',
    messageA: 'message-a',
    attachmentA: randomUUID(),
    blobA: 'a'.repeat(64),
    orphanBlobA: 'b'.repeat(64),
    commandA: randomUUID(),
    operationA: randomUUID(),
    codeHashA: 'c'.repeat(64),
    proofHashA: 'd'.repeat(64),
  };

  for (const owner of [ids.ownerA, ids.ownerB]) {
    await db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,1)', [
      owner,
      randomUUID(),
    ]);
  }

  await db.pool.query(
    'INSERT INTO devices(id,owner_id,token_hash,generation,last_seen_at,snapshot) VALUES($1,$2,$3,$4,7,$5)',
    [ids.deviceA, ids.ownerA, randomUUID(), ids.generation, JSON.stringify({ owner: 'a' })],
  );

  await db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    ids.ownerA,
    ids.deviceA,
    ids.sessionA,
    JSON.stringify({ generation: 'g1', title: 'Owner A', binding: 'verified', integrationState: 'ready' }),
  ]);

  await db.pool.query('INSERT INTO session_labels(owner_id,device_id,source_key,title) VALUES($1,$2,$3,$4)', [
    ids.ownerA,
    ids.deviceA,
    'source-a',
    'Label A',
  ]);

  await db.pool.query(
    'INSERT INTO session_activity(owner_id,device_id,session_id,last_message_at) VALUES($1,$2,$3,5)',
    [ids.ownerA, ids.deviceA, ids.sessionA],
  );

  await db.pool.query(
    "INSERT INTO reading_positions(owner_id,device_id,session_id,message_id,pixel_offset,cursor,updated_at) VALUES($1,$2,$3,'m',1,NULL,5)",
    [ids.ownerA, ids.deviceA, ids.sessionA],
  );

  await db.pool.query("INSERT INTO user_preferences(owner_id,language,theme) VALUES($1,'en','dark')", [
    ids.ownerA,
  ]);

  await db.pool.query(
    'INSERT INTO events(owner_id,device_id,stream_id,seq,event_id,session_id,occurred_at,data) VALUES($1,$2,$3,1,$4,$5,5,$6)',
    [
      ids.ownerA,
      ids.deviceA,
      ids.streamA,
      'event-a',
      ids.sessionA,
      JSON.stringify({
        type: 'message',
        payload: { id: ids.messageA, role: 'assistant', text: 'A', occurredAt: 5 },
      }),
    ],
  );

  for (const sha of [ids.blobA, ids.orphanBlobA]) {
    await db.pool.query('INSERT INTO attachment_blobs(owner_id,sha256,bytes) VALUES($1,$2,$3)', [
      ids.ownerA,
      sha,
      Buffer.from('synthetic'),
    ]);
  }

  await db.pool.query(
    "INSERT INTO attachments(owner_id,device_id,session_id,id,descriptor,bytes,created_at,expires_at,blob_sha256,device_export,source_message_id,source_position) VALUES($1,$2,$3,$4,$5,NULL,1,$6,$7,true,'message-a','position:a')",
    [
      ids.ownerA,
      ids.deviceA,
      ids.sessionA,
      ids.attachmentA,
      JSON.stringify({
        id: ids.attachmentA,
        sha256: ids.blobA,
        name: 'a.bin',
        mimeType: 'application/octet-stream',
      }),
      Date.now() + 3_600_000,
      ids.blobA,
    ],
  );

  await db.pool.query(
    "INSERT INTO command_audit(owner_id,command_id,device_id,session_id,action,fingerprint,status,created_at) VALUES($1,$2,$3,$4,'create_session','f','accepted',$5)",
    [ids.ownerA, ids.commandA, ids.deviceA, ids.sessionA, Date.now()],
  );

  await db.pool.query(
    'INSERT INTO pairings(code_hash,proof_hash,expires_at,claim_id,owner_id) VALUES($1,$2,$3,$4,$5)',
    [ids.codeHashA, ids.proofHashA, Date.now() + 300_000, randomUUID(), ids.ownerA],
  );

  const continuity = new ContinuityService(db, () => 10);
  const principal = { userId: ids.ownerA, telegramId: 'owner-a' };
  const scope = { deviceId: ids.deviceA, deviceGeneration: ids.generation };
  const conversationId = randomUUID();
  const sourceExecutionId = randomUUID();
  const sourceGeneration = randomUUID();

  await continuity.createConversation(principal, scope, {
    conversationId,
    id: sourceExecutionId,
    provider: 'codex',
    profileId: randomUUID(),
    mode: 'managed_cli',
    nativeSessionId: randomUUID(),
    generation: sourceGeneration,
  });

  await continuity.startHandoff(principal, scope, {
    operationId: ids.operationA,
    request: {
      ownerId: ids.ownerA,
      deviceId: ids.deviceA,
      conversationId,
      expectedConversationVersion: 1,
      sourceExecutionId,
      sourceGeneration,
      checkpointId: randomUUID(),
      checkpointDigest: 'e'.repeat(64),
      expectedProfileVersion: 1,
      selection: { provider: 'claude', profileId: randomUUID(), model: 'claude-test' },
    },
  });

  /** Owner A's row in a table, as JSON text, to show a foreign call changed nothing. */
  const snapshotOf = async (table: string) =>
    JSON.stringify(
      (await db.pool.query(`SELECT * FROM ${table} WHERE owner_id=$1 ORDER BY 1,2,3`, [ids.ownerA])).rows,
    );

  /**
   * Runs a foreign write and returns owner A's rows of `table` before and after it.
   * A write error propagates: a write expected to be refused asserts its own rejection.
   */
  const untouched = async (table: string, write: () => Promise<unknown>) => {
    const before = await snapshotOf(table);

    await write();

    return { before, after: await snapshotOf(table) };
  };

  return { ...ids, db, snapshotOf, untouched, close: database.close };
}
