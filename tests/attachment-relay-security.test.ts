import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { attachmentRelayFixture } from './helpers/attachment-relay.js';
import { MAX_ATTACHMENT_BYTES, type AttachmentDescriptor, type Session } from '@protocol';

let fixture: Awaited<ReturnType<typeof attachmentRelayFixture>>;

beforeEach(async () => {
  fixture = await attachmentRelayFixture();
});

afterEach(async () => {
  await fixture?.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const uploadInput = (bytes = Buffer.from('synthetic'), uploadId = randomUUID()) => ({
  uploadId,
  bytes,
  generation: fixture.session.generation,
  name: 'synthetic.bin',
  mimeType: 'application/octet-stream',
});

const command = (
  attachments: AttachmentDescriptor[],
  session = fixture.session,
  commandId = randomUUID(),
) => ({
  commandId,
  target: session.target,
  sessionId: session.id,
  generation: session.generation,
  action: { type: 'prompt' as const, text: '', attachments },
});

async function connected() {
  const device = fixture.connect('/ws/device', fixture.deviceToken);
  const app = fixture.connect('/ws/app', fixture.token);

  await Promise.all([device.next('authenticated'), app.next('authenticated')]);

  return { device, app };
}

async function stored() {
  const response = await fixture.upload();

  expect(response.status).toBe(200);

  return (await response.json()) as AttachmentDescriptor;
}

async function anotherSession() {
  const session = { ...fixture.session, id: randomUUID() };

  await fixture.database.db.pool.query(
    'INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)',
    [fixture.principal.userId, fixture.deviceId, session.id, JSON.stringify(session)],
  );

  return { ...fixture.context, sessionId: session.id };
}

it('rejects unauthorized headers before receiving any request body', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      fixture.origin + fixture.path,
      {
        method: 'POST',
        headers: {
          ...fixture.headers(),
          authorization: 'Bearer invalid',
          'content-length': MAX_ATTACHMENT_BYTES + 1,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
        req.destroy();
      },
    );

    req.on('error', reject);

    req.setTimeout(2000, () => {
      req.destroy(new Error('AUTH_WAITED_FOR_BODY'));
    });

    req.flushHeaders();
    // Intentionally never send/end the advertised binary body.
  });

  expect(status).toBe(401);

  expect((await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM attachments')).rows[0].n).toBe(
    0,
  );
});

it('rejects declared and chunked oversized bodies without storing bytes', async () => {
  const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x53);

  expect((await fixture.upload(bytes)).status).toBe(413);

  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      fixture.origin + fixture.path,
      { method: 'POST', headers: fixture.headers() },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );

    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('CHUNKED_UPLOAD_TIMEOUT')));
    req.write(bytes.subarray(0, MAX_ATTACHMENT_BYTES));
    req.end(bytes.subarray(MAX_ATTACHMENT_BYTES));
  });

  expect(status).toBe(413);

  expect((await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM attachments')).rows[0].n).toBe(
    0,
  );
});

it('bounds concurrent partial body buffers and releases admission slots after abort', async () => {
  let rejected!: (status: number) => void;

  const rejectedRequest = new Promise<number>((resolve) => {
    rejected = resolve;
  });

  const requests = Array.from({ length: 5 }, () =>
    request(
      fixture.origin + fixture.path,
      {
        method: 'POST',
        headers: { ...fixture.headers(), 'content-length': 8 },
      },
      (response) => {
        response.resume();
        rejected(response.statusCode!);
      },
    ),
  );

  for (const req of requests) {
    req.on('error', () => {});
    req.flushHeaders();
    req.write('x');
  }

  try {
    // The rejected fifth stream proves the other four streams already hold admission slots.
    expect(await rejectedRequest).toBe(429);
    expect((await fixture.upload()).status).toBe(429);
  } finally {
    requests.forEach((req) => req.destroy());
  }

  await expect.poll(async () => (await fixture.upload()).status).toBe(200);
});

it('separates app upload capability from device history export and keeps downloads readable', async () => {
  const descriptor = await stored();

  const session: Session = {
    ...fixture.session,
    capabilities: {
      observe: true,
      history: true,
      prompt: false,
      interrupt: false,
      permission: false,
      terminalSnapshot: false,
    },
  };

  await fixture.database.db.pool.query('UPDATE sessions SET data=$1 WHERE owner_id=$2 AND id=$3', [
    JSON.stringify(session),
    fixture.principal.userId,
    session.id,
  ]);

  expect((await fixture.upload()).status).toBe(409);

  const exported = await fetch(fixture.origin + '/device' + fixture.path, {
    method: 'POST',
    headers: { ...fixture.headers(), ...auth(fixture.deviceToken) },
    body: Buffer.from('native-export'),
  });

  expect(exported.status).toBe(200);

  expect(
    (await fetch(fixture.origin + fixture.path + '/' + descriptor.id, { headers: auth(fixture.token) }))
      .status,
  ).toBe(200);
});

it('disables app uploads globally while preserving authorized native history export', async () => {
  const disabled = await attachmentRelayFixture(false);

  try {
    const rejected = await disabled.upload();

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ code: 'CAPABILITY_UNAVAILABLE' });

    const exported = await fetch(disabled.origin + '/device' + disabled.path, {
      method: 'POST',
      headers: { ...disabled.headers(), ...auth(disabled.deviceToken) },
      body: Buffer.from('synthetic-export'),
    });

    expect(exported.status).toBe(200);
    const descriptor = (await exported.json()) as AttachmentDescriptor;

    expect(
      (await fetch(disabled.origin + disabled.path + '/' + descriptor.id, { headers: auth(disabled.token) }))
        .status,
    ).toBe(200);
  } finally {
    await disabled.close();
  }
});

it('rejects an uploaded attachment when the current session no longer advertises attachments', async () => {
  const descriptor = await stored();
  const { app, device } = await connected();

  const session: Session = {
    ...fixture.session,
    capabilities: {
      observe: true,
      history: true,
      prompt: true,
      interrupt: true,
      permission: true,
      terminalSnapshot: false,
    },
  };

  await fixture.publish(device, session);
  app.send({ type: 'command', command: command([descriptor], session) });
  expect((await app.next('error')).code).toBe('CAPABILITY_UNAVAILABLE');

  expect(
    (await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM command_audit')).rows[0].n,
  ).toBe(0);

  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(0);
});

it('permits reference-mode app uploads and rejects changed metadata under an existing ID', async () => {
  await fixture.database.db.pool.query(
    `UPDATE sessions SET data=jsonb_set(data,'{capabilities,attachments,images}','"reference"') WHERE owner_id=$1 AND id=$2`,
    [fixture.principal.userId, fixture.session.id],
  );

  const descriptor = await stored();
  const body = Buffer.from('synthetic');
  const retry = await fixture.upload(body, descriptor.id);

  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(descriptor);

  for (const headers of [{ 'x-file-name': 'renamed.bin' }, { 'content-type': 'text/plain' }]) {
    const response = await fetch(fixture.origin + fixture.path, {
      method: 'POST',
      headers: { ...fixture.headers(descriptor.id), ...headers },
      body,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'ATTACHMENT_ID_REUSED' });
  }
});

it('serializes the 50MiB owner quota across concurrent sessions and prunes expired quota', async () => {
  const second = await anotherSession();
  const bytes = Buffer.alloc(MAX_ATTACHMENT_BYTES, 0x51);

  const uploads = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      fixture.relay.attachments.store(index % 2 ? second : fixture.context, uploadInput(bytes), false),
    ),
  );

  expect(uploads.filter((result) => result.status === 'fulfilled')).toHaveLength(5);

  expect(
    uploads.filter((result) => result.status === 'rejected').map((result) => result.reason.code),
  ).toEqual(['ATTACHMENT_QUOTA']);

  const total = await fixture.database.db.pool.query(
    'SELECT sum(octet_length(bytes))::int AS n FROM attachments WHERE owner_id=$1',
    [fixture.principal.userId],
  );

  expect(total.rows[0].n).toBe(50 * 1024 * 1024);
  const foreign = await fixture.seed(fixture.otherToken);

  await expect(fixture.relay.attachments.store(foreign.context, uploadInput(), false)).resolves.toMatchObject(
    { byteLength: 9 },
  );

  await fixture.database.db.pool.query('UPDATE attachments SET expires_at=0 WHERE owner_id=$1', [
    fixture.principal.userId,
  ]);

  await expect(
    fixture.relay.attachments.store(fixture.context, uploadInput(bytes), false),
  ).resolves.toMatchObject({ byteLength: MAX_ATTACHMENT_BYTES });

  expect(
    (
      await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM attachments WHERE owner_id=$1', [
        fixture.principal.userId,
      ])
    ).rows[0].n,
  ).toBe(1);
});

it('expires reads and command attachments, and explicit pruning removes the bytes', async () => {
  const descriptor = await stored();
  const { app, device } = await connected();

  await fixture.database.db.pool.query('UPDATE attachments SET expires_at=0 WHERE id=$1', [descriptor.id]);

  const response = await fetch(fixture.origin + fixture.path + '/' + descriptor.id, {
    headers: auth(fixture.token),
  });

  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ code: 'ATTACHMENT_EXPIRED' });
  app.send({ type: 'command', command: command([descriptor]) });
  expect((await app.next('error')).code).toBe('ATTACHMENT_EXPIRED');
  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(0);
  await fixture.relay.attachments.prune();

  expect((await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM attachments')).rows[0].n).toBe(
    0,
  );
});

it('dispatches owned canonical attachments over real WebSockets and deduplicates the original IDs', async () => {
  const descriptor = await stored();
  const { app, device } = await connected();
  const original = command([descriptor]);

  app.send({ type: 'command', command: original });

  expect((await app.next('command_result')).result).toEqual({
    commandId: original.commandId,
    status: 'accepted',
  });

  const delivered = (await device.next('command')).command;

  expect(delivered.action).toEqual(original.action);
  expect(delivered.commandId).toBe(original.commandId);
  expect(delivered.generation).toBe('g1');
  expect(delivered.expiresAt).toBeGreaterThan(Date.now());
  app.send({ type: 'command', command: original });

  expect((await app.next('command_result')).result).toEqual({
    commandId: original.commandId,
    status: 'accepted',
  });

  const sentinel = command([descriptor]);

  app.send({ type: 'command', command: sentinel });
  await app.next('command_result');
  expect((await device.next('command')).command.commandId).toBe(sentinel.commandId);
  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(2);
  app.send({ type: 'command', command: { ...original, action: { ...original.action, text: 'changed' } } });
  expect((await app.next('error')).code).toBe('COMMAND_ID_REUSED');

  expect(
    (await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM command_audit')).rows[0].n,
  ).toBe(2);
});

it('rejects spoofed, foreign-owner, foreign-device and foreign-session descriptors before command audit', async () => {
  const descriptor = await stored();
  const { app, device } = await connected();
  const foreignOwner = await fixture.seed(fixture.otherToken);
  const foreignSession = await anotherSession();

  // The one-active-device constraint permits only a revoked historical sibling device.
  const historicalDevice = randomUUID(),
    historical = { ...descriptor, id: randomUUID() };

  await fixture.database.db.pool.query(
    'INSERT INTO devices(id,owner_id,token_hash,generation,revoked_at) VALUES($1,$2,$3,$4,$5)',
    [historicalDevice, fixture.principal.userId, randomUUID(), 'old-device', Date.now()],
  );

  await fixture.database.db.pool.query(
    'INSERT INTO attachments(owner_id,device_id,session_id,id,descriptor,bytes,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      fixture.principal.userId,
      historicalDevice,
      fixture.session.id,
      historical.id,
      JSON.stringify(historical),
      Buffer.from('synthetic'),
      Date.now(),
      Date.now() + 60_000,
    ],
  );

  const descriptors = [
    { descriptor: { ...descriptor, name: 'spoofed.bin' }, code: 'ATTACHMENT_MISMATCH' },
    { descriptor: historical, code: 'NOT_FOUND' },
    ...(await Promise.all(
      [foreignOwner.context, foreignSession].map(async (context) => ({
        descriptor: await fixture.relay.attachments.store(context, uploadInput(), false),
        code: 'NOT_FOUND',
      })),
    )),
  ];

  for (const invalid of descriptors) {
    app.send({ type: 'command', command: command([invalid.descriptor]) });
    expect((await app.next('error')).code).toBe(invalid.code);
  }

  expect(
    (await fixture.database.db.pool.query('SELECT count(*)::int AS n FROM command_audit')).rows[0].n,
  ).toBe(0);

  expect(device.frames.filter((frame) => frame.type === 'command')).toHaveLength(0);
  const sentinel = command([descriptor]);

  app.send({ type: 'command', command: sentinel });
  await app.next('command_result');
  expect((await device.next('command')).command.commandId).toBe(sentinel.commandId);
});

it('keeps an uploaded draft across connection replacement and a stable-session generation change', async () => {
  const descriptor = await stored();
  const { device: oldDevice, app } = await connected();
  const replaced = new Promise<number>((resolve) => oldDevice.socket.once('close', resolve));
  const device = fixture.connect('/ws/device', fixture.deviceToken);

  await device.next('authenticated');
  expect(await replaced).toBe(4002);
  const session = { ...fixture.session, generation: 'g2' };

  await fixture.publish(device, session);

  const download = await fetch(fixture.origin + fixture.path + '/' + descriptor.id, {
    headers: auth(fixture.token),
  });

  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from('synthetic'));
  app.send({ type: 'command', command: command([descriptor]) });
  expect((await app.next('error')).code).toBe('STALE_SESSION');
  const fresh = command([descriptor], session);

  app.send({ type: 'command', command: fresh });
  expect((await app.next('command_result')).result.status).toBe('accepted');
  expect((await device.next('command')).command.action).toEqual(fresh.action);
  const staleUpload = await fixture.upload();

  expect(staleUpload.status).toBe(409);
  expect(await staleUpload.json()).toEqual({ code: 'STALE_SESSION' });
});

it('logout invalidates app bytes and command access while device export remains authorized', async () => {
  const descriptor = await stored();
  const { app } = await connected();
  const closed = new Promise<number>((resolve) => app.socket.once('close', resolve));

  expect(
    (await fetch(fixture.origin + '/auth/logout', { method: 'POST', headers: auth(fixture.token) })).status,
  ).toBe(200);

  expect(await closed).toBe(4001);
  expect((await fixture.upload()).status).toBe(401);

  expect(
    (await fetch(fixture.origin + fixture.path + '/' + descriptor.id, { headers: auth(fixture.token) }))
      .status,
  ).toBe(401);

  expect(
    (
      await fetch(fixture.origin + '/commands', {
        method: 'POST',
        headers: {
          ...auth(fixture.token),
          'content-type': 'application/json',
        },
        body: JSON.stringify(command([descriptor])),
      })
    ).status,
  ).toBe(401);

  expect(
    (
      await fetch(fixture.origin + '/device' + fixture.path + '/' + descriptor.id, {
        headers: auth(fixture.deviceToken),
      })
    ).status,
  ).toBe(200);
});

it('revoke closes the device and removes app/device attachment access immediately', async () => {
  const descriptor = await stored();
  const { device } = await connected();
  const closed = new Promise<number>((resolve) => device.socket.once('close', resolve));

  expect(
    (
      await fetch(fixture.origin + '/devices/' + fixture.deviceId, {
        method: 'DELETE',
        headers: auth(fixture.token),
      })
    ).status,
  ).toBe(200);

  expect(await closed).toBe(4003);
  expect((await fixture.upload()).status).toBe(404);

  expect(
    (await fetch(fixture.origin + fixture.path + '/' + descriptor.id, { headers: auth(fixture.token) }))
      .status,
  ).toBe(404);

  expect(
    (
      await fetch(fixture.origin + '/device' + fixture.path + '/' + descriptor.id, {
        headers: auth(fixture.deviceToken),
      })
    ).status,
  ).toBe(401);
});
