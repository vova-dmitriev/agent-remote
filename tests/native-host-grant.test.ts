import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalDatabase } from '../apps/daemon/src/local/state/database.js';
import { LocalGrants } from '../apps/daemon/src/local/grants/service.js';

const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const databases: LocalDatabase[] = [];

function fixture(owner = 'local-owner-a') {
  const database = new LocalDatabase(':memory:');

  databases.push(database);

  return new LocalGrants(database, owner, 'device-a', [origin]);
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

it('requires explicit local approval before issuing a revocable handle', () => {
  const grants = fixture();
  const clientId = randomUUID();

  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  expect(grants.pending()).toEqual([{ clientId, origin }]);
  grants.approve(clientId, origin);
  const grant = grants.connect(origin, clientId);

  expect(grant.ownerId).toBe('local-owner-a');
  expect(grant.deviceId).toBe('device-a');
  expect(grants.current(grant)).toBe(true);
  expect(() => grants.connect(origin, clientId)).toThrow('UNAUTHORIZED');
  expect(grants.connect(origin, clientId, grant.handle).ownerId).toBe('local-owner-a');
  grants.revoke(clientId);
  expect(grants.current(grant)).toBe(false);
  expect(() => grants.connect(origin, clientId, grant.handle)).toThrow('LOCAL_GRANT_REVOKED');
});

it('denies wrong origins, unknown approvals and handles from another owner', () => {
  const grants = fixture();
  const clientId = randomUUID();

  expect(() => grants.connect('https://example.com/', clientId)).toThrow('UNAUTHORIZED');
  expect(() => grants.approve(clientId, origin)).toThrow('NOT_FOUND');
  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  grants.approve(clientId, origin);
  const grant = grants.connect(origin, clientId);
  const other = fixture('local-owner-b');

  expect(other.current(grant)).toBe(false);
  expect(() => grants.connect(origin, clientId, randomUUID())).toThrow('UNAUTHORIZED');
});

it('withdraws current leases and queued authority when an origin is uninstalled', () => {
  const grants = fixture();
  const clientId = randomUUID();

  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  grants.approve(clientId, origin);
  const principal = grants.connect(origin, clientId);

  grants.replaceOrigins([]);
  expect(grants.current(principal)).toBe(false);
  expect(grants.approvedClient(clientId, origin)).toBe(false);
});

it('returns expired unclaimed approval to pending so the user can authorize again', () => {
  const grants = fixture();
  const clientId = randomUUID();

  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  grants.approve(clientId, origin);
  databases.at(-1)!.connection.prepare('UPDATE local_grants SET expires_at=0').run();
  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  expect(grants.pending()).toEqual([{ clientId, origin }]);
  grants.approve(clientId, origin);
  expect(grants.current(grants.connect(origin, clientId))).toBe(true);
});

it('permits explicit trusted reauthorization while keeping previously issued handles invalid', () => {
  const grants = fixture();
  const clientId = randomUUID();

  expect(() => grants.connect(origin, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  grants.approve(clientId, origin);
  const first = grants.connect(origin, clientId);

  grants.revoke(clientId);
  grants.approve(clientId, origin);
  const replacement = grants.connect(origin, clientId, first.handle);

  expect(replacement.handle).not.toBe(first.handle);
  expect(grants.current(first)).toBe(false);
  expect(grants.current(replacement)).toBe(true);
});
