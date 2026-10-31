import { expect, it } from 'vitest';
import type { Session } from '@protocol';
import { groupByProject, PINNED_GROUP } from '@/pages/sessions/lib/group-by-project.js';

const session = (id: string, cwd?: string, pinned = false) => ({ id, cwd, pinned }) as unknown as Session;

it('leads with pinned, then keeps projects in list order and same-named folders apart', () => {
  const groups = groupByProject([
    session('a', '/work/one/app'),
    session('b', '/work/two/app'),
    session('c', '/work/one/app', true),
    session('d'),
    session('e', '/work/one/app'),
  ]);

  expect(groups.map(({ key, name, sessions }) => [key, name, sessions.map(({ id }) => id)])).toEqual([
    [PINNED_GROUP, null, ['c']],
    ['/work/one/app', 'app', ['a', 'e']],
    ['/work/two/app', 'app', ['b']],
    ['none', null, ['d']],
  ]);
});
