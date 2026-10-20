// Wire fixtures deliberately use literal values independent of the validators.
export function executionProfile(id = '00000000-0000-4000-8000-000000000001') {
  return {
    id,
    ownerId: 'owner-a',
    deviceId: 'mac-a',
    provider: 'codex',
    authMode: 'subscription',
    label: 'OpenAI Personal',
    status: 'ready',
    identity: { accountRef: 'synthetic-account-a', verifiedAt: 1000 },
    capabilities: {
      isolation: 'supported',
      createSession: true,
      contextSeed: true,
      resume: false,
      quota: false,
    },
    models: [{ id: 'synthetic-model', efforts: ['medium', 'high'] }],
    version: 1,
    updatedAt: 1000,
  };
}

export function executionSelection() {
  return {
    profileId: '00000000-0000-4000-8000-000000000001',
    provider: 'codex',
    model: 'synthetic-model',
    effort: 'high',
  };
}

export function handoffRequest() {
  return {
    ownerId: 'owner-a',
    deviceId: 'mac-a',
    conversationId: 'conversation-a',
    expectedConversationVersion: 1,
    sourceExecutionId: 'source-a',
    sourceGeneration: 'generation-a',
    checkpointId: 'checkpoint-a',
    checkpointDigest: 'a'.repeat(64),
    expectedProfileVersion: 1,
    selection: executionSelection(),
  };
}
