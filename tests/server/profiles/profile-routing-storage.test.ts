import { expect, it } from 'vitest';
import { databaseFixture } from '../../helpers/database.js';
import { ProfileRoutingRepository } from '@server/profiles/routing/repository.js';
import {
  fallbackPolicySchema,
  profileQuotaObservationSchema,
  AgentProvider,
  CapabilitySupport,
  ProfileAuthMode,
  ProfileStatus,
  FallbackMode,
  QuotaEvidenceKind,
  QuotaObservationStatus,
  QuotaScopeKind,
  QuotaSource,
} from '@protocol';

it('persists fenced routing settings and only current ready-profile quota observations', async () => {
  const fixture = await databaseFixture();

  const repository = new ProfileRoutingRepository(fixture.db);
  const profileId = '11111111-1111-4111-8111-111111111111';

  try {
    await fixture.db.pool.query("INSERT INTO users(id,telegram_id,created_at) VALUES('owner','991',0)");

    await fixture.db.pool.query(
      "INSERT INTO devices(id,owner_id,token_hash,generation) VALUES('device','owner','hash','generation-a')",
    );

    await fixture.db.pool.query(
      'INSERT INTO execution_profile_metadata(owner_id,device_id,data) VALUES($1,$2,$3)',
      [
        'owner',
        'device',
        JSON.stringify({
          available: true,
          observedAt: 100,
          profiles: [
            {
              id: profileId,
              ownerId: 'owner',
              deviceId: 'device',
              provider: AgentProvider.Codex,
              authMode: ProfileAuthMode.Subscription,
              label: 'Primary',
              status: ProfileStatus.Ready,
              identity: { accountRef: 'account-a', workspaceRef: 'workspace-a', verifiedAt: 100 },
              capabilities: {
                isolation: CapabilitySupport.Supported,
                createSession: true,
                contextSeed: true,
                resume: false,
                quota: false,
              },
              models: [{ id: 'codex-model', efforts: [] }],
              version: 4,
              updatedAt: 100,
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              ownerId: 'owner',
              deviceId: 'device',
              provider: AgentProvider.Codex,
              authMode: ProfileAuthMode.Subscription,
              label: 'Backup',
              status: ProfileStatus.Ready,
              identity: { accountRef: 'account-b', workspaceRef: 'workspace-b', verifiedAt: 100 },
              capabilities: {
                isolation: CapabilitySupport.Supported,
                createSession: true,
                contextSeed: true,
                resume: false,
                quota: false,
              },
              models: [{ id: 'codex-model', efforts: [] }],
              version: 4,
              updatedAt: 100,
            },
          ],
          operations: [],
          defaults: { claude: null, codex: profileId },
        }),
      ],
    );

    const policy = fallbackPolicySchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Account fallback',
      mode: FallbackMode.Ask,
      rules: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          sourceProfileId: profileId,
          sourceProfileVersion: 4,
          destinationProfileId: '44444444-4444-4444-8444-444444444444',
          destinationProfileVersion: 4,
          destinationProvider: AgentProvider.Codex,
          destinationModel: 'codex-model',
          trigger: 'quota_exhausted',
        },
      ],
      contextScope: ['task_summary'],
      moveUnsentQueue: false,
      apiSpending: { enabled: false, limitUsd: null },
    });

    const saved = await repository.save('owner', 'device', 'generation-a', {
      expectedVersion: 0,
      defaultPolicyId: policy.id,
      policies: [policy],
      overrides: [],
    });

    expect(saved.version).toBe(1);

    await expect(
      repository.save('owner', 'device', 'generation-a', {
        expectedVersion: 0,
        defaultPolicyId: null,
        policies: [],
        overrides: [],
      }),
    ).rejects.toThrow('LOCAL_REVISION_CONFLICT');

    const observation = profileQuotaObservationSchema.parse({
      ownerId: 'owner',
      deviceId: 'device',
      profileId,
      profileVersion: 4,
      provider: AgentProvider.Codex,
      authMode: ProfileAuthMode.Subscription,
      accountRef: 'account-a',
      workspaceRef: 'workspace-a',
      source: QuotaSource.CodexRateLimits,
      supported: true,
      scope: { kind: QuotaScopeKind.Workspace, id: 'workspace-a' },
      poolId: 'codex',
      status: QuotaObservationStatus.Exhausted,
      evidence: { kind: QuotaEvidenceKind.UsageBlocked, allowed: false },
      observedAt: 200,
    });

    await repository.recordObservation('owner', 'device', 'generation-a', observation);

    await expect(
      repository.recordObservation('owner', 'device', 'generation-b', observation),
    ).rejects.toThrow('NOT_FOUND');

    expect((await repository.get('owner', 'device')).observations).toEqual([observation]);
  } finally {
    await fixture.close();
  }
});
