import { expect, it } from 'vitest';
import * as protocol from '@protocol';

it('exposes reusable device and receipt values without changing the wire vocabulary', () => {
  expect(protocol.DeviceStatus).toEqual({ Online: 'online', Offline: 'offline' });

  expect(protocol.CommandStatus).toEqual({
    Accepted: 'accepted',
    Dispatched: 'dispatched',
    Rejected: 'rejected',
    Unknown: 'unknown',
  });
});

it('uses the same constants in strict status schemas and preserves receipt JSON', () => {
  expect(protocol.statusSchema.options).toEqual(Object.values(protocol.SessionStatus));
  expect(protocol.integrationStateSchema.options).toEqual(Object.values(protocol.IntegrationState));
  const result = { commandId: 'synthetic-command', status: protocol.CommandStatus.Dispatched };

  expect(protocol.resultSchema.parse(result)).toEqual({
    commandId: 'synthetic-command',
    status: 'dispatched',
  });

  expect(() => protocol.resultSchema.parse({ ...result, status: 'synthetic-unrecognized-status' })).toThrow();
});

// These exports predate the domain objects; preserve their ordered tuple API.
it('preserves ordered tuple exports and schema membership', () => {
  const first: 'command' = protocol.ACTIVITY_KINDS[0];
  const latest: 'latest' = protocol.HISTORY_DIRECTIONS[0];

  expect(first).toBe('command');
  expect(latest).toBe('latest');
  expect(protocol.LANGUAGE_PREFERENCES).toEqual(['ru', 'en']);
  expect(protocol.THEME_PREFERENCES).toEqual(['auto', 'light', 'dark']);
});
