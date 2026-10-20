import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalDatabase } from '@daemon/local/state/database.js';
import { LocalGrants } from '@daemon/local/grants/service.js';
import { LocalOrigin } from '@protocol';

const chromeOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const database = new LocalDatabase(':memory:');
const grants = new LocalGrants(database, 'local-owner', 'device', [chromeOrigin]);

afterEach(() => {
  database.connection.prepare('DELETE FROM local_grants').run();
});

it('requires native approval for the fixed desktop origin and fences revoked reconnects', () => {
  const clientId = randomUUID();

  expect(() => grants.connect(LocalOrigin.Desktop, clientId)).toThrow('LOCAL_APPROVAL_REQUIRED');
  expect(grants.pending()).toEqual([{ clientId, origin: LocalOrigin.Desktop }]);
  grants.approve(clientId, LocalOrigin.Desktop);
  const first = grants.connect(LocalOrigin.Desktop, clientId);

  expect(grants.current(first)).toBe(true);
  grants.revoke(clientId);
  expect(grants.current(first)).toBe(false);
  expect(() => grants.connect(LocalOrigin.Desktop, clientId, first.handle)).toThrow('LOCAL_GRANT_REVOKED');
});

it('keeps Chrome origins strict and rejects arbitrary schemes or client origins', () => {
  const clientId = randomUUID();

  expect(() => grants.connect('codex-desktop://forged/', clientId)).toThrow('UNAUTHORIZED');
  expect(() => grants.replaceOrigins([LocalOrigin.Desktop])).toThrow('UNAUTHORIZED');

  expect(() => grants.connect(chromeOrigin, clientId, 'forged-client-principal')).toThrow(
    'LOCAL_APPROVAL_REQUIRED',
  );

  expect(() => grants.approve(clientId, 'https://example.com/')).toThrow('UNAUTHORIZED');
});
