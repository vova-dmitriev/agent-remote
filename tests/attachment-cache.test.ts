import { expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database.js';
import { AttachmentRepository } from '../apps/server/src/attachments/repositories/attachments.js';
import { AttachmentService } from '../apps/server/src/attachments/service.js';
import { sessionSchema } from '@protocol';

it('deduplicates derived blobs, keeps original upload bytes, evicts only rebuildable exports and preserves legacy IDs during migration', async () => {
  const fixture = await databaseFixture();
  const context = { ownerId: 'owner', deviceId: 'device', sessionId: 'session' };

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','991',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','g')",
    );

    const session = sessionSchema.parse({
      id: 'session',
      generation: 'g',
      target: {
        kind: 'claude-code-cli',
        deviceId: 'device',
        connectorId: 'native',
        claudeSessionId: 'source',
      },
      claudeSessionId: 'source',
      status: 'idle',
      binding: 'verified',
      lastEventAt: 1,
      capabilities: {
        observe: true,
        history: true,
        prompt: true,
        interrupt: true,
        permission: false,
        terminalSnapshot: false,
        attachments: { images: 'reference', files: 'reference' },
      },
      integrationState: 'ready',
      statusConfidence: 'observed',
    });

    await fixture.db.pool.query(
      "INSERT INTO sessions(owner_id,device_id,id,data) VALUES('owner','device','session',$1)",
      [JSON.stringify(session)],
    );

    const service = new AttachmentService(new AttachmentRepository(fixture.db)),
      upload = (bytes: Buffer, name = 'synthetic.txt') => ({
        uploadId: randomUUID(),
        generation: 'g',
        name,
        mimeType: 'text/plain',
        bytes,
      });

    const original = await service.store(context, upload(Buffer.from('Original upload')), false);

    const bytes = Buffer.alloc(10 * 1024 * 1024, 65),
      firstInput = {
        ...upload(bytes),
        source: { messageId: 'native-image', position: 'position:synthetic' },
      },
      first = await service.store(context, firstInput, true);

    const repeated = await service.store(context, upload(bytes), true);

    expect(repeated.id).toBe(first.id);

    expect((await fixture.db.pool.query('SELECT count(*)::int AS n FROM attachment_blobs')).rows[0].n).toBe(
      1,
    );

    for (let index = 1; index <= 5; index++) {
      await service.store(context, upload(Buffer.alloc(10 * 1024 * 1024, 65 + index)), true);
    }

    expect((await service.read(context, original.id)).bytes.toString()).toBe('Original upload');
    await expect(service.read(context, first.id)).rejects.toThrow('ATTACHMENT_REBUILD_REQUIRED');
    expect(await service.source(context, first.id)).toEqual(firstInput.source);
    await expect(service.source({ ...context, ownerId: 'foreign' }, first.id)).rejects.toThrow('NOT_FOUND');
    expect(await service.available(context, first.id)).toBe(false);
    expect((await service.store(context, { ...firstInput, uploadId: randomUUID() }, true)).id).toBe(first.id);

    expect(
      createHash('sha256')
        .update((await service.read(context, first.id)).bytes)
        .digest('hex'),
    ).toBe(first.sha256);

    expect(await service.available(context, first.id)).toBe(true);

    const physical = Number(
      (await fixture.db.pool.query('SELECT sum(octet_length(bytes))::bigint AS n FROM attachment_blobs'))
        .rows[0].n,
    );

    expect(physical).toBeLessThanOrEqual(50 * 1024 * 1024);
    const legacyId = '11111111-1111-5111-a111-111111111111';

    const legacyBytes = Buffer.from('Legacy file'),
      legacy = await service.store(context, { ...upload(legacyBytes), uploadId: legacyId }, false);

    // Stage an existing 001–005 database with a legacy row before migration 006 is installed.
    await fixture.db.pool.query("DELETE FROM server_schema_migrations WHERE version='006_attachment_cache'");

    await fixture.db.migrate();
    expect((await service.read(context, legacy.id)).bytes).toEqual(legacyBytes);

    expect(
      (await fixture.db.pool.query('SELECT bytes IS NULL AS moved FROM attachments WHERE id=$1', [legacy.id]))
        .rows[0].moved,
    ).toBe(true);

    expect(
      (
        await fixture.db.pool.query(
          "SELECT 1 FROM server_schema_migrations WHERE version='006_attachment_cache'",
        )
      ).rowCount,
    ).toBe(1);

    await fixture.db.migrate();

    expect(
      (await fixture.db.pool.query('SELECT bytes IS NULL AS moved FROM attachments WHERE id=$1', [legacy.id]))
        .rows[0].moved,
    ).toBe(true);

    await fixture.db.pool.query('UPDATE attachments SET expires_at=0 WHERE device_export');
    await service.prune();
    expect((await service.read(context, legacy.id)).bytes).toEqual(legacyBytes);
  } finally {
    await fixture.close();
  }
});
