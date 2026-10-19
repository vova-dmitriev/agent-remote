import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { databaseFixture } from './helpers/database.js';
import { initData, testBotToken } from './helpers/telegram.js';
import { createRelay } from '../apps/server/src/app/create-relay.js';
import { hash } from '../apps/server/src/auth/security.js';

let fixture: Awaited<ReturnType<typeof databaseFixture>>, relay: Awaited<ReturnType<typeof createRelay>>;
let origin: string, token: string, other: string;

const sessionId = 'http-session',
  deviceId = 'http-device',
  deviceToken = 'synthetic-device-token';

const uploadId = randomUUID(),
  bytes = Buffer.from('{"binary":"json preserved"}');

const path = `/sessions/${sessionId}/attachments`;

const headers = () => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'x-upload-id': uploadId,
  'x-file-name': encodeURIComponent('данные.json'),
  'x-session-generation': 'g',
});

beforeAll(async () => {
  fixture = await databaseFixture();

  relay = await createRelay({
    databaseUrl: fixture.url,
    schema: fixture.schema,
    botToken: testBotToken,
    publicOrigin: 'http://localhost',
    inputEnabled: true,
  });

  origin = await relay.listen(0);
  token = (await relay.auth.login(initData('400001'))).token;
  other = (await relay.auth.login(initData('400002'))).token;
  const principal = await relay.auth.authenticate(token);

  await fixture.db.pool.query('INSERT INTO devices(id,owner_id,token_hash,generation) VALUES($1,$2,$3,$4)', [
    deviceId,
    principal.userId,
    hash(deviceToken),
    'g',
  ]);

  const data = {
    id: sessionId,
    generation: 'g',
    target: { kind: 'codex-cli', deviceId, connectorId: 'c', threadId: 't' },
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
  };

  await fixture.db.pool.query('INSERT INTO sessions(owner_id,device_id,id,data) VALUES($1,$2,$3,$4)', [
    principal.userId,
    deviceId,
    sessionId,
    JSON.stringify(data),
  ]);
});

afterAll(async () => {
  await relay?.close();
  await fixture?.close();
});

it('authenticates before binary parsing and preserves JSON bytes', async () => {
  const denied = await fetch(origin + path, {
    method: 'POST',
    headers: { ...headers(), authorization: 'Bearer wrong' },
    body: Buffer.from('not JSON'),
  });

  expect(denied.status).toBe(401);
  const response = await fetch(origin + path, { method: 'POST', headers: headers(), body: bytes });

  expect(response.status).toBe(200);

  expect(await response.json()).toMatchObject({
    id: uploadId,
    name: 'данные.json',
    kind: 'file',
    byteLength: bytes.length,
  });

  const download = await fetch(origin + path + '/' + uploadId, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
  expect(download.headers.get('content-type')).toContain('application/octet-stream');
  expect(download.headers.get('content-disposition')).toContain("filename*=UTF-8''");
  expect(download.headers.get('cache-control')).toBe('no-store');
});

it('stores a JSON-typed upload byte for byte instead of parsing it', async () => {
  const id = randomUUID();
  const json = Buffer.from('{"a":1}' + ' '.repeat(1000));

  const response = await fetch(origin + path, {
    method: 'POST',
    headers: { ...headers(), 'x-upload-id': id },
    body: json,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id, byteLength: json.length });

  const download = await fetch(origin + path + '/' + id, { headers: { authorization: `Bearer ${token}` } });

  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(json);
});

it('isolates owner and device tokens and revokes existing attachment access', async () => {
  expect(
    (await fetch(origin + path + '/' + uploadId, { headers: { authorization: `Bearer ${other}` } })).status,
  ).toBe(404);

  expect(
    (await fetch(origin + path + '/' + uploadId, { headers: { authorization: `Bearer ${deviceToken}` } }))
      .status,
  ).toBe(401);

  expect(
    (
      await fetch(origin + `/device${path}/${uploadId}`, {
        headers: { authorization: `Bearer ${deviceToken}` },
      })
    ).status,
  ).toBe(200);

  expect(
    (await fetch(origin + `/device${path}/${uploadId}`, { headers: { authorization: `Bearer ${token}` } }))
      .status,
  ).toBe(401);

  const principal = await relay.auth.authenticate(token);

  await relay.devices.revoke(principal, deviceId);

  expect(
    (await fetch(origin + path + '/' + uploadId, { headers: { authorization: `Bearer ${token}` } })).status,
  ).toBe(404);

  expect(
    (
      await fetch(origin + `/device${path}/${uploadId}`, {
        headers: { authorization: `Bearer ${deviceToken}` },
      })
    ).status,
  ).toBe(401);
});
