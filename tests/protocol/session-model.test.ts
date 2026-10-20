import { describe, expect, it } from 'vitest';
import { sessionSchema } from '@protocol';
import { sessionSnapshot } from '../e2e/support/session-fixtures.js';

describe('session model contract', () => {
  it('accepts bounded explicit per-session models and legacy sessions', () => {
    const session = sessionSnapshot('device').sessions[0]!;

    expect(sessionSchema.parse({ ...session, model: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
    expect(sessionSchema.safeParse(session).success).toBe(true);

    for (const model of ['', '  ', 'x'.repeat(257), 'unsafe\nmodel']) {
      expect(sessionSchema.safeParse({ ...session, model }).success).toBe(false);
    }
  });
});
