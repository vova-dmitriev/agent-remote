import { join } from 'node:path';
import { expect, it } from 'vitest';
import { pinDesktopUserData } from '@desktop/main/user-data.js';

it('keeps companion state at the pre-rename userData path', () => {
  const calls: string[] = [];

  const path = pinDesktopUserData({
    getPath: () => '/Users/example/Library/Application Support',
    setPath: (_name, value) => calls.push(value),
  });

  expect(path).toBe(join('/Users/example/Library/Application Support', 'agent-remote-desktop'));
  expect(calls).toEqual([path]);
});
