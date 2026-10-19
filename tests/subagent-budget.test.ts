import { expect, it } from 'vitest';
import { boundSubagentSnapshots } from '../apps/daemon/src/activity/subagents.js';
import { sessionSchema, noCapabilities } from '@protocol';

it('keeps snapshots below transport bounds with many large child tasks and preserves active children first', () => {
  const sessions = Array.from({ length: 10 }, (_, index) =>
    sessionSchema.parse({
      id: String(index),
      generation: 'g',
      target: { kind: 'codex-cli', deviceId: 'device', connectorId: 'c', threadId: String(index) },
      claudeSessionId: null,
      status: 'running',
      binding: 'verified',
      lastEventAt: 1,
      capabilities: noCapabilities,
      integrationState: 'ready',
      statusConfidence: 'observed',
      subagents: Array.from({ length: 50 }, (_, i) => ({
        id: 'child-' + index + '-' + i,
        task: 'x'.repeat(4096),
        status: i === 49 ? 'running' : 'completed',
        updatedAt: i,
      })),
    }),
  );

  const bounded = boundSubagentSnapshots(sessions);

  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(50000);

  expect(
    bounded.flatMap((s) => s.subagents ?? []).filter((agent) => agent.status === 'running'),
  ).toHaveLength(10);

  expect(sessions[0]?.subagents?.[0]?.task).toHaveLength(4096);
});
