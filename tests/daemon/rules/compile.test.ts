import { ErrorCode } from '@protocol';
import { expect, it } from 'vitest';
import { compileRule } from '@daemon/rules/compile.js';

const answer = (value: unknown) => async () => JSON.stringify(value);

it('turns a sentence into a named list of patterns', async () => {
  const prompts: string[] = [];

  const rule = await compileRule('ask before anything touches the prod database', async (prompt) => {
    prompts.push(prompt);

    return (
      'Here you go:\n' +
      JSON.stringify({ name: 'Prod database', patterns: ['prod-db', String.raw`\bpsql\b.*prod`] })
    );
  });

  expect(rule).toEqual({ name: 'Prod database', patterns: ['prod-db', String.raw`\bpsql\b.*prod`] });
  // The sentence is data inside the prompt, quoted as JSON, not instructions.
  expect(prompts[0]).toContain(JSON.stringify('ask before anything touches the prod database'));
});

it('refuses patterns that are not regular expressions, too many, or none', async () => {
  for (const bad of [
    { name: 'x', patterns: ['('] },
    { name: 'x', patterns: Array.from({ length: 21 }, (_, i) => `p${i}`) },
    { name: 'x', patterns: [] },
    'not json at all',
  ]) {
    await expect(compileRule('anything', answer(bad))).rejects.toThrow(ErrorCode.INVALID_REQUEST);
  }
});
