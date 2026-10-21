import { expect, it } from 'vitest';
import * as protocol from '@protocol';

it('exposes bounded skill metadata without paths or skill bodies', () => {
  const schema = (protocol as Record<string, unknown>).sessionSkillsSchema;

  expect(schema).toBeDefined();

  const skills = schema as {
    parse(value: unknown): unknown;
    safeParse(value: unknown): { success: boolean };
  };

  const response = {
    sessionId: 'session-a',
    generation: 'generation-a',
    supported: true,
    skills: [{ name: 'review', description: 'Review changes', invocation: '/review' }],
  };

  expect(skills.parse(response)).toEqual({ ...response, truncated: false });

  expect(
    skills.safeParse({ ...response, skills: [{ ...response.skills[0], path: '/secret' }] }).success,
  ).toBe(false);

  expect(skills.safeParse({ ...response, skills: [{ ...response.skills[0], body: 'secret' }] }).success).toBe(
    false,
  );

  expect(
    skills.safeParse({ ...response, skills: [{ ...response.skills[0], invocation: '/review run' }] }).success,
  ).toBe(false);
});
