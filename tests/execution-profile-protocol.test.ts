import { expect, it } from 'vitest';
import * as protocol from '@protocol';
import { executionProfile, executionSelection, handoffRequest } from './helpers/execution-profile.js';

it('represents two retained OpenAI subscription profiles with independent verified identities', () => {
  const a = executionProfile();

  const b = {
    ...executionProfile('00000000-0000-4000-8000-000000000002'),
    label: 'OpenAI Work',
    identity: { accountRef: 'synthetic-account-b', verifiedAt: 1000 },
  };

  expect(protocol.executionProfileSummarySchema?.safeParse(a).success).toBe(true);
  expect(protocol.executionProfileSummarySchema?.safeParse(b).success).toBe(true);
});

it.each(['apiKey', 'accessToken', 'refreshToken', 'environment', 'credentialHandle', 'runtimeHome'])(
  'rejects private profile field %s rather than stripping it silently',
  (field) => {
    expect(
      protocol.executionProfileSummarySchema?.safeParse({
        ...executionProfile(),
        [field]: 'synthetic-private-value',
      }).success,
    ).toBe(false);
  },
);

it('rejects readiness without verified identity or isolated credentials', () => {
  expect(
    protocol.executionProfileSummarySchema?.safeParse({
      ...executionProfile(),
      identity: null,
    }).success,
  ).toBe(false);

  expect(
    protocol.executionProfileSummarySchema?.safeParse({
      ...executionProfile(),
      capabilities: { ...executionProfile().capabilities, isolation: 'unknown' },
    }).success,
  ).toBe(false);
});

it.each([
  { provider: 'claude' },
  { profileId: '00000000-0000-4000-8000-000000000002' },
  { model: 'unoffered-model' },
  { effort: 'unsupported-effort' },
  { executable: '/private/untrusted' },
  { environment: { OPENAI_API_KEY: 'synthetic-private-value' } },
])('rejects an incompatible or caller-controlled launch selection: %j', (change) => {
  expect(
    protocol.executionLaunchPlanSchema?.safeParse({
      profile: executionProfile(),
      selection: { ...executionSelection(), ...change },
    }).success,
  ).toBe(false);
});

it('allows an offered model/effort only on a ready profile', () => {
  expect(
    protocol.executionLaunchPlanSchema?.safeParse({
      profile: executionProfile(),
      selection: executionSelection(),
    }).success,
  ).toBe(true);

  expect(
    protocol.executionLaunchPlanSchema?.safeParse({
      profile: { ...executionProfile(), status: 'disabled' },
      selection: executionSelection(),
    }).success,
  ).toBe(false);
});

it('preserves legacy creation and rejects unwired profile selection instead of billing a default account', () => {
  const action = {
    type: protocol.CommandActionType.CreateSession,
    provider: protocol.AgentProvider.Codex,
    cwd: '/synthetic/project',
  };

  expect(protocol.actionSchema.safeParse(action).success).toBe(true);
  expect(protocol.actionSchema.safeParse({ ...action, execution: executionSelection() }).success).toBe(false);
});

it('fences handoff requests and forbids secret or arbitrary runtime inputs', () => {
  expect(protocol.handoffRequestSchema?.safeParse(handoffRequest()).success).toBe(true);

  expect(
    protocol.handoffRequestSchema?.safeParse({
      ...handoffRequest(),
      expectedProfileVersion: -1,
    }).success,
  ).toBe(false);

  expect(
    protocol.handoffRequestSchema?.safeParse({
      ...handoffRequest(),
      checkpointDigest: 'not-a-digest',
    }).success,
  ).toBe(false);

  expect(
    protocol.handoffRequestSchema?.safeParse({
      ...handoffRequest(),
      apiKey: 'synthetic-private-value',
    }).success,
  ).toBe(false);
});

it('cannot report a ready handoff before identifying a created destination', () => {
  const operation = {
    ...handoffRequest(),
    id: 'operation-a',
    phase: 'ready',
    targetExecutionId: null,
    createCommandId: 'create-a',
    seedCommandId: 'seed-a',
    updatedAt: 1000,
  };

  expect(protocol.handoffOperationSchema?.safeParse(operation).success).toBe(false);

  expect(
    protocol.handoffOperationSchema?.safeParse({
      ...operation,
      targetExecutionId: 'target-b',
    }).success,
  ).toBe(true);
});

it('requires a frozen policy version for automatically approved context', () => {
  const checkpoint = {
    id: 'checkpoint-a',
    sourceExecutionId: 'source-a',
    sourceGeneration: 'gen-a',
    historyWatermark: 'message-a',
    digest: 'a'.repeat(64),
    createdAt: 1000,
    coverage: 'recent_window',
    messageCount: 10,
    attachmentCount: 0,
    approval: { kind: 'policy', policyId: 'policy-a' },
  };

  expect(protocol.contextCheckpointSummarySchema?.safeParse(checkpoint).success).toBe(false);

  expect(
    protocol.contextCheckpointSummarySchema?.safeParse({
      ...checkpoint,
      approval: { ...checkpoint.approval, policyVersion: 1, scopeDigest: 'b'.repeat(64) },
    }).success,
  ).toBe(true);
});

it('rejects native execution identities that mix provider and profile selection', () => {
  const link = {
    id: 'execution-a',
    conversationId: 'conversation-a',
    ownerId: 'owner-a',
    deviceId: 'mac-a',
    profileId: executionSelection().profileId,
    provider: 'codex',
    mode: 'managed_cli',
    nativeSessionId: 'codex-native-a',
    generation: 'generation-a',
    createdAt: 1000,
  };

  expect(protocol.executionLinkSchema?.safeParse(link).success).toBe(true);

  expect(protocol.executionLinkSchema?.safeParse({ ...link, claudeSessionId: 'foreign-id' }).success).toBe(
    false,
  );
});
