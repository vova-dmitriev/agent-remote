import { expect, it } from 'vitest';
import { validatePrompt } from '@protocol';

it('enforces UTF-8 byte limits and rejects terminal control injection', () => {
  expect(validatePrompt('👋'.repeat(4096))).toBe('👋'.repeat(4096));
  expect(() => validatePrompt('👋'.repeat(4097))).toThrow('PROMPT_TOO_LARGE');

  for (const text of ['\x1b[201~pwd', '\x00', '\r', '\u009b31m']) {
    expect(() => validatePrompt(text)).toThrow('INVALID_PROMPT');
  }

  expect(validatePrompt('line one\n\tline two')).toBe('line one\n\tline two');
});
