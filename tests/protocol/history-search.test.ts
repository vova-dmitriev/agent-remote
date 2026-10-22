import { expect, it } from 'vitest';
import { HISTORY_SEARCH_LEAD_CHARS, MessageRole, searchMessages } from '@protocol';

const message = (id: string, text: string, tool?: object) => ({
  id,
  role: MessageRole.Assistant,
  text,
  occurredAt: 1,
  ...(tool ? { tool } : {}),
});

it('finds the words in any case and letters, cuts a snippet before them and skips tool lines', () => {
  const long = 'x'.repeat(HISTORY_SEARCH_LEAD_CHARS * 2) + ' Деплой на ВМ';

  const found = searchMessages(
    [
      message('a', 'Сделай ДЕПЛОЙ сегодня'),
      message('b', long),
      message('c', 'деплой', { id: 't', name: 'Bash', phase: 'started' }),
      message('d', 'nothing'),
    ],
    '  деплой ',
  );

  expect(found.map((item) => item.id)).toEqual(['a', 'b']);
  expect(found[0]!.text).toBe('Сделай ДЕПЛОЙ сегодня');
  expect(found[1]!.text.startsWith('…')).toBe(true);
  expect(found[1]!.text).toContain('Деплой на ВМ');
  expect(searchMessages([message('a', 'text')], '   ')).toEqual([]);
});
