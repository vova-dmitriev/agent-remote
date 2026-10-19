import { expect, it } from 'vitest';

it('keeps the public @protocol export set stable', async () => {
  expect(Object.keys(await import('@protocol')).sort()).toMatchSnapshot();
});
