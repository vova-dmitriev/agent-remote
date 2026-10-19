import { expect, it } from 'vitest';
import { AgentProvider } from '../packages/protocol/src/values/command.js';
import { ProfileAuthMode } from '../packages/protocol/src/values/execution.js';
import {
  QuotaObservationStatus,
  QuotaScopeKind,
  QuotaSource,
} from '../packages/protocol/src/values/profile-routing.js';
import { ProfileRequestKind } from '../packages/protocol/src/values/profile-management.js';
import { BoundProfileClient } from '../packages/transport/src/profile-client.js';

const request = {
  kind: ProfileRequestKind.Quota,
  profileId: '11111111-1111-4111-8111-111111111111',
  expectedVersion: 2,
} as const;

const observation = {
  ownerId: '22222222-2222-4222-8222-222222222222',
  deviceId: 'device-a',
  profileId: request.profileId,
  profileVersion: request.expectedVersion,
  provider: AgentProvider.Codex,
  authMode: ProfileAuthMode.Subscription,
  accountRef: 'codex-account',
  source: QuotaSource.CodexRateLimits,
  supported: true,
  scope: { kind: QuotaScopeKind.Account },
  status: QuotaObservationStatus.Unknown,
  evidence: null,
  observedAt: Date.now(),
};

it('accepts unavailable quota reads without inventing a device record', async () => {
  const client = new BoundProfileClient('device-a', async () => ({
    kind: ProfileRequestKind.Quota,
    data: null,
  }));

  await expect(client.request(request)).resolves.toEqual({
    kind: ProfileRequestKind.Quota,
    data: null,
  });
});

it('rejects quota observations bound to another device', async () => {
  const client = new BoundProfileClient('device-a', async () => ({
    kind: ProfileRequestKind.Quota,
    data: { ...observation, deviceId: 'device-b' },
  }));

  await expect(client.request(request)).rejects.toThrow('ACCESS_DENIED');
});
