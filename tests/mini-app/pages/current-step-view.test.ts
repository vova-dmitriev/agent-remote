import { expect, it } from 'vitest';
import { activityKey } from '@/pages/session/lib/activity.js';
import type { Session } from '@protocol';

it('shows safe active step labels only for an available running source', () => {
  const session = {
    status: 'running',
    statusConfidence: 'observed',
    lastEventAt: 100,
    currentActivity: { id: 'tool', kind: 'command', startedAt: 100 },
  } as Session;

  expect(activityKey(session, true, 200)).toBe('activityCommand');
  expect(activityKey({ ...session, status: 'waiting_permission' }, true, 200)).toBeNull();
  expect(activityKey(session, false, 200)).toBeNull();
  expect(activityKey({ ...session, currentActivity: undefined }, true, 200)).toBe('activityWorking');
  expect(activityKey({ ...session, currentActivity: undefined }, true, 200000)).toBeNull();

  expect(
    activityKey({ ...session, currentActivity: undefined, statusConfidence: 'inferred' }, true, 200),
  ).toBeNull();
});
