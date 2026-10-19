import { expect, it } from 'vitest';
import { AgentProvider } from '../packages/protocol/src/values/command.js';
import {
  fallbackPolicySchema,
  profileRoutingSettingsSchema,
} from '../packages/protocol/src/profile-routing.js';
import { FallbackMode, FallbackOverrideMode } from '../packages/protocol/src/values/profile-routing.js';

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

function policy(edges: Array<[string, string]>) {
  return {
    id: id('1'),
    name: 'Primary account order',
    mode: FallbackMode.Ask,
    rules: edges.map(([sourceProfileId, destinationProfileId], index) => ({
      id: id(String(index + 2)),
      sourceProfileId,
      sourceProfileVersion: 1,
      destinationProfileId,
      destinationProfileVersion: 1,
      destinationProvider: AgentProvider.Codex,
      destinationModel: 'synthetic-model',
      trigger: 'quota_exhausted',
    })),
    contextScope: ['task_summary'],
    moveUnsentQueue: false,
    apiSpending: { enabled: false, limitUsd: null },
  };
}

it('accepts an ordered acyclic chain within the three-transition bound', () => {
  const result = fallbackPolicySchema.parse(
    policy([
      [id('2'), id('3')],
      [id('3'), id('4')],
      [id('4'), id('5')],
    ]),
  );

  expect(result.rules.map((rule) => rule.destinationProfileId)).toEqual([id('3'), id('4'), id('5')]);
});

it('rejects cycles and chains that exceed the automatic transition bound', () => {
  expect(() =>
    fallbackPolicySchema.parse(
      policy([
        [id('2'), id('3')],
        [id('3'), id('2')],
      ]),
    ),
  ).toThrow();

  expect(() =>
    fallbackPolicySchema.parse(
      policy([
        [id('2'), id('3')],
        [id('3'), id('4')],
        [id('4'), id('5')],
        [id('5'), id('6')],
      ]),
    ),
  ).toThrow();
});

it('requires explicit spending bounds for API destinations', () => {
  expect(() =>
    fallbackPolicySchema.parse({
      ...policy([[id('2'), id('3')]]),
      apiSpending: { enabled: true, limitUsd: null },
    }),
  ).toThrow();
});

it('requires conversation overrides to name either inheritance, Off, or a saved policy', () => {
  const settings = {
    ownerId: 'owner-a',
    deviceId: 'device-a',
    version: 1,
    defaultPolicyId: id('1'),
    policies: [policy([[id('2'), id('3')]])],
    overrides: [{ conversationId: 'conversation-a', mode: FallbackOverrideMode.Policy, policyId: id('9') }],
  };

  expect(() => profileRoutingSettingsSchema.parse(settings)).toThrow();
  expect(FallbackMode.Automatic).toBe('automatic');
});
