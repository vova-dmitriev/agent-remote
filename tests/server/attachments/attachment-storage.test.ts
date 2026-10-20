import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/relay/database.js';
import { AttachmentRepository } from '@server/attachments/repositories/attachments.js';
import { AttachmentService } from '@server/attachments/service.js';
import { sessionSchema } from '@protocol';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
let service: AttachmentService;

const owner = 'attachment-owner',
  device = 'attachment-device',
  sessionId = 'attachment-session';

const context = { ownerId: owner, deviceId: device, sessionId };

const session = sessionSchema.parse({
  id: sessionId,
  generation: 'generation',
  target: { kind: 'codex-cli', deviceId: device, connectorId: 'connector', threadId: 'thread' },
  claudeSessionId: null,
  status: 'idle',
  binding: 'verified',
  lastEventAt: 1,
  capabilities: {
    observe: true,
    history: true,
    prompt: true,
    interrupt: true,
    permission: true,
    terminalSnapshot: false,
    attachments: { images: 'native', files: 'reference' },
  },
  integrationState: 'ready',
  statusConfidence: 'observed',
});

beforeAll(async () => {
  fixture = await databaseFixture();

  await fixture.db.pool.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3)', [
    owner,
    '100001',
    Date.now(),
  ]);

  await fixture.db.pool.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,$4)', [
    device,
    owner,
    'hash',
    'generation',
  ]);

  await fixture.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    owner,
    device,
    sessionId,
    JSON.stringify(session),
  ]);

  service = new AttachmentService(new AttachmentRepository(fixture.db));
});

afterAll(async () => fixture?.close());

it('stores canonical private bytes idempotently and rejects spoofed descriptors', async () => {
  const uploadId = randomUUID(),
    bytes = Buffer.from('{"synthetic":true}');

  const descriptor = await service.store(
    context,
    { uploadId, name: 'sample.json', mimeType: 'application/json', generation: 'generation', bytes },
    false,
  );

  expect(descriptor).toMatchObject({
    id: uploadId,
    byteLength: bytes.length,
    kind: 'file',
    mimeType: 'application/json',
  });

  expect((await service.read(context, uploadId)).bytes).toEqual(bytes);

  expect(
    await service.store(
      context,
      { uploadId, name: 'sample.json', mimeType: 'application/json', generation: 'generation', bytes },
      false,
    ),
  ).toEqual(descriptor);

  await expect(service.validate(context, [{ ...descriptor, name: 'spoofed' }])).rejects.toMatchObject({
    code: 'ATTACHMENT_MISMATCH',
  });

  await expect(
    service.store(
      context,
      {
        uploadId,
        name: 'sample.json',
        mimeType: 'application/json',
        generation: 'generation',
        bytes: Buffer.from('different'),
      },
      false,
    ),
  ).rejects.toMatchObject({ code: 'ATTACHMENT_ID_REUSED' });

  await expect(service.read({ ...context, ownerId: 'another-owner' }, uploadId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });

  await expect(service.read({ ...context, sessionId: 'another-session' }, uploadId)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

it('checks source generation and treats HTML/SVG as non-preview downloads', async () => {
  await expect(
    service.store(
      context,
      {
        uploadId: randomUUID(),
        name: 'stale.txt',
        mimeType: 'text/plain',
        generation: 'stale',
        bytes: Buffer.from('test'),
      },
      false,
    ),
  ).rejects.toMatchObject({ code: 'STALE_SESSION' });

  const descriptor = await service.store(
    context,
    {
      uploadId: randomUUID(),
      name: 'unsafe.svg',
      mimeType: 'image/svg+xml',
      generation: 'generation',
      bytes: Buffer.from('<svg onload="alert(1)"></svg>'),
    },
    false,
  );

  expect(descriptor.kind).toBe('file');
  await fixture.db.pool.query('UPDATE attachments SET expires_at=0 WHERE id=$1', [descriptor.id]);
  await expect(service.read(context, descriptor.id)).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
});
