import { expect, it } from 'vitest';
import { previewText } from '../../../apps/mini-app/src/pages/session/lib/preview-text.js';

it('preserves Markdown paragraphs and code indentation in previews', () => {
  const text = '**Ready**\n\n- Next\n\n```ts\n  const answer = 42;\n```';

  expect(previewText(text)).toBe(text);
});

it('unwraps native pasted content without removing the useful message', () => {
  expect(
    previewText('<pasted_content id="demo">\n**PR ready**\n\nhttps://example.test/pr/1\n</pasted_content>'),
  ).toBe('**PR ready**\n\nhttps://example.test/pr/1');
});

it('shows a native task summary and result instead of transport identifiers', () => {
  const text =
    '<task-notification>\n<task-id>private-id</task-id>\n<tool-use-id>tool_demo</tool-use-id>\n<output-file>/tmp/internal.log</output-file>\n<status>completed</status>\n<summary>**Review complete**</summary>\n<result>- No blockers\n- Tests passed</result>\n</task-notification>';

  expect(previewText(text)).toBe('**Review complete**\n\n- No blockers\n- Tests passed');
});

it('preserves literal wrapper examples in code and ordinary user prose', () => {
  const text = 'Example:\n\n```xml\n<task-notification><task-id>demo</task-id></task-notification>\n```';

  expect(previewText(text)).toBe(text);
});

it.each(['', 'A'])('bounds long previews without splitting a Unicode character after %j', (prefix) => {
  const result = previewText(prefix + '🧑'.repeat(5000));

  expect(result.length).toBeLessThanOrEqual(1601);
  expect(result).toMatch(/🧑…$/u);
  expect(result).not.toMatch(/[\uD800-\uDBFF]…$/u);
});
