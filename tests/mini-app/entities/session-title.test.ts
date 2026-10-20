import { describe, expect, it } from 'vitest';
import { sessionSchema } from '@protocol';
import { sessionTitle } from '../../../apps/mini-app/src/entities/session/lib/labels.js';
import { sessionSnapshot } from '../../e2e/support/session-fixtures.js';

describe('session display titles', () => {
  it('preserves an optional bounded title in the wire contract', () => {
    const session = sessionSnapshot('device').sessions[1]!;

    expect(sessionSchema.parse({ ...session, title: 'Synthetic session title' }).title).toBe(
      'Synthetic session title',
    );

    expect(sessionSchema.safeParse({ ...session, title: 'x'.repeat(513) }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...session, title: '   ' }).success).toBe(false);
    expect(sessionSchema.safeParse(session).success).toBe(true);
  });

  it('prefers the full real title over the source identifier in both views', () => {
    const session = { ...sessionSnapshot('device').sessions[0]!, title: 'Synthetic renamed session title' };

    expect(sessionTitle(session, 12)).toBe('Synthetic renamed session title');
    expect(sessionTitle(session, 16)).toBe('Synthetic renamed session title');
  });

  it('keeps source-specific identifier and selected-chat fallbacks when no title exists', () => {
    const sessions = sessionSnapshot('device').sessions;

    expect(sessionTitle(sessions[2]!, 12)).toBe('codex-cli-th');
    expect(sessionTitle(sessions[1]!, 16)).toBeNull();
    expect(sessionTitle({ ...sessions[2]!, title: '  ' }, 16)).toBe('codex-cli-thread');
  });
});
