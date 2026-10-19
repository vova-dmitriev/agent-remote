import { expect, it } from 'vitest';
import { BoundProfileRoutingClient } from '../packages/transport/src/profile-routing-client.js';
import { HttpRequestMethod } from '../packages/protocol/src/values/http.js';

it('uses only the owner-bound routing endpoint and validates saved values', async () => {
  const calls: Array<[string, string, unknown]> = [];

  const client = new BoundProfileRoutingClient('device-a', async (method, path, body) => {
    calls.push([method, path, body]);

    return {
      ownerId: 'owner-a',
      deviceId: 'device-a',
      version: 0,
      defaultPolicyId: null,
      policies: [],
      overrides: [],
    };
  });

  const settings = await client.save({
    expectedVersion: 0,
    defaultPolicyId: null,
    policies: [],
    overrides: [],
  });

  expect(settings.deviceId).toBe('device-a');

  expect(calls).toEqual([
    [
      HttpRequestMethod.Put,
      '/devices/device-a/profile-routing',
      {
        expectedVersion: 0,
        defaultPolicyId: null,
        policies: [],
        overrides: [],
      },
    ],
  ]);
});

it('rejects a response from a stale runtime epoch after the request resolves', async () => {
  let active = true;

  const client = new BoundProfileRoutingClient(
    'device-a',
    async () => {
      active = false;

      return {
        settings: {
          ownerId: 'owner-a',
          deviceId: 'device-a',
          version: 0,
          defaultPolicyId: null,
          policies: [],
          overrides: [],
        },
        observations: [],
      };
    },
    () => active,
  );

  await expect(client.get()).rejects.toThrow('STALE_EPOCH');
});
